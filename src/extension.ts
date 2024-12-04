import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DOMParser } from 'xmldom';

const execAsync = promisify(exec);

interface ProjectConfig {
    prefix: string;
    suffix: string;
}

async function getProjectConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<ProjectConfig> {
    const config = vscode.workspace.getConfiguration('packageDuplicator', workspaceFolder.uri);
    
    return {
        prefix: config.get('filePrefix', 'CRMLEAD000'),
        suffix: config.get('fileSuffix', '')
    };
}

async function configureProject(workspaceFolder: vscode.WorkspaceFolder) {
    const prefix = await vscode.window.showInputBox({
        prompt: 'Ingresa el prefijo para los archivos (incluyendo ceros si son necesarios)',
        placeHolder: 'Ejemplo: CRMLEAD000',
        value: 'CRMLEAD000'
    });

    const suffix = await vscode.window.showInputBox({
        prompt: 'Ingresa el sufijo (opcional)',
        placeHolder: 'Ejemplo: SFDC'
    });

    if (prefix) {
        await vscode.workspace.getConfiguration('packageDuplicator', workspaceFolder.uri).update('filePrefix', prefix, vscode.ConfigurationTarget.WorkspaceFolder);
        await vscode.workspace.getConfiguration('packageDuplicator', workspaceFolder.uri).update('fileSuffix', suffix || '', vscode.ConfigurationTarget.WorkspaceFolder);
        
        vscode.window.showInformationMessage(`Configuración guardada: Prefijo="${prefix}", Sufijo="${suffix || '(ninguno)'}"`);
    }
}

async function revertPackageXmlIfChanged(workspacePath: string): Promise<void> {
    try {
        const packageXmlPath = path.join(workspacePath, 'manifest', 'package.xml');
        
        // Verificar si hay cambios en package.xml
        const { stdout } = await execAsync('git status --porcelain manifest/package.xml', {
            cwd: workspacePath
        });

        if (stdout.trim()) {
            // Hay cambios, revertir
            await execAsync('git checkout manifest/package.xml', {
                cwd: workspacePath
            });
            vscode.window.showInformationMessage('Se ha revertido package.xml a su estado original');
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
        console.error('Error al revertir package.xml:', errorMessage);
        vscode.window.showErrorMessage('Error al intentar revertir package.xml');
    }
}

// Añadir esta función helper
function mergePackageXmls(xmlFiles: string[]): string {
    const parser = new DOMParser();
    let mergedTypes: { [key: string]: Set<string> } = {};

    xmlFiles.forEach(xmlContent => {
        const doc = parser.parseFromString(xmlContent, 'text/xml');
        const types = doc.getElementsByTagName('types');

        for (const type of Array.from(types)) {
            const name = type.getElementsByTagName('name')[0].textContent;
            const members = Array.from(type.getElementsByTagName('members'))
                .map(member => member.textContent);

            if (name) {
                if (!mergedTypes[name]) {
                    mergedTypes[name] = new Set();
                }
                members.forEach(member => {
                    if (member) mergedTypes[name].add(member);
                });
            }
        }
    });

    // Crear el XML combinado
    let result = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    result += '<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';
    
    Object.entries(mergedTypes).forEach(([name, members]) => {
        result += '\t<types>\n';
        Array.from(members).sort().forEach(member => {
            result += `\t\t<members>${member}</members>\n`;
        });
        result += `\t\t<name>${name}</name>\n`;
        result += '\t</types>\n';
    });
    
    result += '\t<version>60.0</version>\n';
    result += '</Package>';

    return result;
}

async function buildPackageFromGitChanges(workspaceFolder: vscode.WorkspaceFolder) {
    try {
        // Obtener cambios de Git
        const { stdout } = await execAsync('git diff --name-status HEAD', {
            cwd: workspaceFolder.uri.fsPath
        });

        if (!stdout.trim()) {
            vscode.window.showInformationMessage('No se detectaron cambios en Git');
            return;
        }

        // Procesar los cambios de Git
        const changes = stdout.split('\n')
            .filter(line => line.trim())
            .map(line => {
                const [status, file] = line.trim().split(/\s+/);
                return { status, file };
            })
            .filter(change => change.file && change.file.startsWith('force-app/'));

        if (changes.length === 0) {
            vscode.window.showInformationMessage('No se encontraron cambios en archivos de Salesforce');
            return;
        }

        // Añadir estos logs después de procesar los cambios
        console.log('Cambios detectados:', changes);
        
        // Mapear los cambios a metadatos de Salesforce
        const metadataMap: { [key: string]: Set<string> } = {};
        
        changes.forEach(change => {
            log('Procesando archivo: ' + change.file);
            // Normalizar los separadores de ruta a forward slashes
            const normalizedPath = change.file.replace(/\\/g, '/');
            const parts = normalizedPath.split('/');
            log('Partes de la ruta: ' + JSON.stringify(parts));
            if (parts.length >= 4) {
                // Buscar el índice del tipo de metadato (classes, flows, etc.)
                const metadataFolders = ['classes', 'flows', 'triggers', 'pages', 'components', 'objects', 'layouts'];
                const metadataTypeIndex = parts.findIndex(part => metadataFolders.includes(part));
                
                if (metadataTypeIndex !== -1) {
                    const metadataType = parts[metadataTypeIndex];
                    let fileName = parts[parts.length - 1];
                    
                    // Remover extensiones comunes
                    fileName = fileName.replace('.cls', '')
                                    .replace('.flow-meta.xml', '')
                                    .replace('.trigger', '')
                                    .replace('.page', '')
                                    .replace('.component', '')
                                    .replace('.object-meta.xml', '');
                    
                    const apiName = mapMetadataType(metadataType);
                    log(`Tipo de metadato: ${metadataType} -> ${apiName}`);
                    if (apiName) {
                        if (!metadataMap[apiName]) {
                            metadataMap[apiName] = new Set();
                        }
                        metadataMap[apiName].add(fileName);
                    }
                }
            }
        });
        log('Mapa de metadatos final: ' + JSON.stringify(Object.fromEntries(
            Object.entries(metadataMap).map(([k, v]) => [k, Array.from(v)])
        ), null, 2));

        // Preguntar al usuario qué acción desea realizar
        const opcion = await vscode.window.showQuickPick(
            [
                { label: 'Crear nuevo package.xml', description: 'Crea un nuevo archivo con los cambios de Git' },
                { label: 'Modificar package.xml existente', description: 'Añade los cambios al package.xml actual' },
                { label: 'Duplicar y añadir cambios', description: 'Duplica el package.xml y añade los cambios de Git' }
            ],
            { placeHolder: '¿Qué acción deseas realizar con los cambios detectados?' }
        );

        if (!opcion) {
            return; // Usuario canceló la selección
        }

        switch (opcion.label) {
            case 'Crear nuevo package.xml':
                const fileName = await vscode.window.showInputBox({
                    prompt: 'Introduce el nombre para el nuevo package.xml',
                    placeHolder: 'ejemplo: mi-package.xml',
                    value: `git-changes-${new Date().toISOString().replace(/[:.]/g, '-')}.xml`,
                    validateInput: (value) => {
                        if (!value) {
                            return 'El nombre del archivo es requerido';
                        }
                        if (!value.endsWith('.xml')) {
                            return 'El archivo debe tener extensión .xml';
                        }
                        return null;
                    }
                });

                if (!fileName) {
                    vscode.window.showInformationMessage('Operación cancelada');
                    return;
                }
                await createNewPackage(workspaceFolder, metadataMap, fileName);
                break;
            
            case 'Modificar package.xml existente':
                await modifyExistingPackage(workspaceFolder, metadataMap);
                break;
            
            case 'Duplicar y añadir cambios':
                await duplicateAndAddChanges(workspaceFolder, metadataMap);
                break;
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
        vscode.window.showErrorMessage(`Error al procesar los cambios: ${errorMessage}`);
    }
}

async function createNewPackage(workspaceFolder: vscode.WorkspaceFolder, metadataMap: { [key: string]: Set<string> }, fileName: string) {
    let packageXml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    packageXml += '<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';

    Object.entries(metadataMap).sort().forEach(([type, members]) => {
        packageXml += '\t<types>\n';
        Array.from(members).sort().forEach(member => {
            packageXml += `\t\t<members>${member}</members>\n`;
        });
        packageXml += `\t\t<name>${type}</name>\n`;
        packageXml += '\t</types>\n';
    });

    packageXml += '\t<version>60.0</version>\n';
    packageXml += '</Package>';

    const manifestFolder = path.join(workspaceFolder.uri.fsPath, 'manifest');
    const filePath = path.join(manifestFolder, fileName);

    // Verificar si el archivo ya existe
    if (fs.existsSync(filePath)) {
        const overwrite = await vscode.window.showWarningMessage(
            `El archivo ${fileName} ya existe. ¿Deseas sobrescribirlo?`,
            'Sí',
            'No'
        );
        
        if (overwrite !== 'Sí') {
            vscode.window.showInformationMessage('Operación cancelada');
            return;
        }
    }

    fs.writeFileSync(filePath, packageXml);
    vscode.window.showInformationMessage(`Package.xml creado: ${fileName}`);
}

async function modifyExistingPackage(workspaceFolder: vscode.WorkspaceFolder, metadataMap: { [key: string]: Set<string> }) {
    const packagePath = path.join(workspaceFolder.uri.fsPath, 'manifest', 'package.xml');
    const parser = new DOMParser();
    const xmlContent = fs.readFileSync(packagePath, 'utf-8');
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

    // Crear un mapa para almacenar todos los miembros existentes
    const existingMembers: { [key: string]: Set<string> } = {};

    // Leer los miembros existentes
    Array.from(xmlDoc.getElementsByTagName('types')).forEach(typeElement => {
        const typeName = typeElement.getElementsByTagName('name')[0]?.textContent;
        if (typeName) {
            existingMembers[typeName] = new Set(
                Array.from(typeElement.getElementsByTagName('members'))
                    .map(member => member.textContent)
                    .filter(content => content !== null) as string[]
            );
        }
    });

    // Combinar con los nuevos miembros
    Object.entries(metadataMap).forEach(([type, members]) => {
        if (!existingMembers[type]) {
            existingMembers[type] = new Set();
        }
        members.forEach(member => existingMembers[type].add(member));
    });

    // Crear nuevo XML con formato correcto
    let newXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    newXml += '<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';

    // Ordenar los tipos y sus miembros
    Object.keys(existingMembers).sort().forEach(type => {
        newXml += '\t<types>\n';
        Array.from(existingMembers[type]).sort().forEach(member => {
            newXml += `\t\t<members>${member}</members>\n`;
        });
        newXml += `\t\t<name>${type}</name>\n`;
        newXml += '\t</types>\n';
    });

    newXml += '\t<version>60.0</version>\n';
    newXml += '</Package>';

    // Guardar los cambios
    fs.writeFileSync(packagePath, newXml);
    vscode.window.showInformationMessage('Package.xml modificado exitosamente');
}

async function duplicateAndAddChanges(workspaceFolder: vscode.WorkspaceFolder, metadataMap: { [key: string]: Set<string> }) {
    // Primero duplicar el package usando el comando existente
    await vscode.commands.executeCommand('extension.duplicatePackage');
    
    // Esperar un momento para asegurar que el archivo se ha creado
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Obtener el último archivo creado en la carpeta manifest
    const manifestFolder = path.join(workspaceFolder.uri.fsPath, 'manifest');
    const files = fs.readdirSync(manifestFolder)
        .filter(file => file.endsWith('.xml'))
        .map(file => ({
            name: file,
            time: fs.statSync(path.join(manifestFolder, file)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

    if (files.length > 0) {
        const lastFile = files[0].name;
        const packagePath = path.join(manifestFolder, lastFile);
        
        // Modificar el archivo duplicado con los cambios de Git
        const parser = new DOMParser();
        const xmlContent = fs.readFileSync(packagePath, 'utf-8');
        const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

        // Añadir los nuevos elementos
        Object.entries(metadataMap).forEach(([type, members]) => {
            let typeElement = Array.from(xmlDoc.getElementsByTagName('types'))
                .find(elem => elem.getElementsByTagName('name')[0]?.textContent === type);

            if (!typeElement) {
                typeElement = xmlDoc.createElement('types');
                const nameElem = xmlDoc.createElement('name');
                nameElem.textContent = type;
                typeElement.appendChild(nameElem);
                xmlDoc.documentElement.insertBefore(typeElement, xmlDoc.getElementsByTagName('version')[0]);
            }

            members.forEach(member => {
                const memberElem = xmlDoc.createElement('members');
                memberElem.textContent = member;
                typeElement.insertBefore(memberElem, typeElement.getElementsByTagName('name')[0]);
            });
        });

        // Guardar los cambios
        fs.writeFileSync(packagePath, xmlDoc.toString());
        vscode.window.showInformationMessage(`Package duplicado y modificado: ${lastFile}`);
    }
}

// Función auxiliar para mapear tipos de metadatos
function mapMetadataType(folderName: string): string {
    const metadataMapping: { [key: string]: string } = {
        'classes': 'ApexClass',
        'triggers': 'ApexTrigger',
        'pages': 'ApexPage',
        'components': 'ApexComponent',
        'objects': 'CustomObject',
        'layouts': 'Layout',
        'workflows': 'Workflow',
        'profiles': 'Profile',
        'permissionsets': 'PermissionSet',
        'labels': 'CustomLabels',
        'staticresources': 'StaticResource',
        'aura': 'AuraDefinitionBundle',
        'lwc': 'LightningComponentBundle',
        'flows': 'Flow',
        'flowDefinitions': 'FlowDefinition',
        'applications': 'CustomApplication',
        'email': 'EmailTemplate',
        'reports': 'Report',
        'dashboards': 'Dashboard',
        'tabs': 'CustomTab',
        'settings': 'Settings',
        'customMetadata': 'CustomMetadata',
        'globalValueSets': 'GlobalValueSet',
        'queues': 'Queue',
        'quickActions': 'QuickAction',
        'sharingRules': 'SharingRules',
        'weblinks': 'CustomPageWebLink'
    };

    const result = metadataMapping[folderName];
    if (!result) {
        console.log(`Tipo de metadato no mapeado: ${folderName}`);
    }
    return result || '';
}

// Crear un canal de salida para los logs
const outputChannel = vscode.window.createOutputChannel('SF Package Duplicator');

// Función helper para logging
function log(message: string) {
    outputChannel.appendLine(message);
    if (typeof message === 'object') {
        outputChannel.appendLine(JSON.stringify(message, null, 2));
    } else {
        outputChannel.appendLine(message.toString());
    }
}

export function activate(context: vscode.ExtensionContext) {
    let configCommand = vscode.commands.registerCommand('extension.configurePackageDuplicator', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            await configureProject(workspaceFolder);
        }
    });

    let disposable = vscode.commands.registerCommand('extension.duplicatePackage', async () => {
        // Pedir número de ticket
        const ticketNumber = await vscode.window.showInputBox({
            prompt: 'Ingresa el número de ticket',
            placeHolder: 'Ejemplo: 1234'
        });

        if (!ticketNumber) {
            return;
        }

        // Obtener el workspace
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No se encontró la carpeta del workspace');
            return;
        }

        const manifestFolder = path.join(workspaceFolder.uri.fsPath, 'manifest');
        const packageXmlPath = path.join(manifestFolder, 'package.xml');
        
        // Verificar si existe package.xml
        if (!fs.existsSync(packageXmlPath)) {
            vscode.window.showErrorMessage('No se encontró el archivo "manifest/package.xml". Por favor, asegúrate de que existe en el proyecto.');
            return;
        }

        try {
            // Obtener lista de carpetas y añadir opciones especiales
            const folders = [
                'manifest',
                '+ Crear nueva carpeta',
                ...fs.readdirSync(manifestFolder)
                    .filter(item => {
                        try {
                            return fs.statSync(path.join(manifestFolder, item)).isDirectory();
                        } catch (error) {
                            return false;
                        }
                    })
            ];

            const selectedFolder = await vscode.window.showQuickPick(folders, {
                placeHolder: 'Selecciona la carpeta destino'
            });

            if (!selectedFolder) {
                return;
            }

            let targetFolder = selectedFolder;
            
            // Si selecciona crear nueva carpeta
            if (selectedFolder === '+ Crear nueva carpeta') {
                const newFolderName = await vscode.window.showInputBox({
                    prompt: 'Ingresa el nombre de la nueva carpeta',
                    placeHolder: 'Ejemplo: feature-123'
                });

                if (!newFolderName) {
                    return;
                }

                const newFolderPath = path.join(manifestFolder, newFolderName);
                
                try {
                    fs.mkdirSync(newFolderPath);
                    targetFolder = newFolderName;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
                    vscode.window.showErrorMessage(`Error al crear la carpeta: ${errorMessage}`);
                    return;
                }
            }

            // Obtener configuración del proyecto
            const config = await getProjectConfig(workspaceFolder);

            // Crear nuevo nombre de archivo con la configuración
            const newFileName = `${config.prefix}${ticketNumber}${config.suffix}.xml`;
            // Si es 'manifest', guardamos directamente en la carpeta manifest
            const targetPath = targetFolder === 'manifest' 
                ? path.join(manifestFolder, newFileName)
                : path.join(manifestFolder, targetFolder, newFileName);

            try {
                fs.copyFileSync(packageXmlPath, targetPath);
                
                // Revertir package.xml si hay cambios
                await revertPackageXmlIfChanged(workspaceFolder.uri.fsPath);

                vscode.window.showInformationMessage(`Archivo duplicado como ${newFileName}`);
            } catch (error) {
                vscode.window.showErrorMessage('Error al duplicar el archivo');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
            vscode.window.showErrorMessage(`Error al acceder a la carpeta manifest: ${errorMessage}`);
            return;
        }
    });

    // Añadir el nuevo comando en activate()
    let mergeCommand = vscode.commands.registerCommand('extension.mergePackages', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No se encontró la carpeta del workspace');
            return;
        }

        const manifestFolder = path.join(workspaceFolder.uri.fsPath, 'manifest');

        // Preguntar el modo de selección
        const selectionMode = await vscode.window.showQuickPick(
            [
                { label: 'Seleccionar archivos individuales', value: 'files' },
                { label: 'Seleccionar carpeta completa', value: 'folder' }
            ],
            { placeHolder: '¿Cómo quieres seleccionar los archivos a combinar?' }
        );

        if (!selectionMode) return;

        try {
            let xmlFiles: string[] = [];

            if (selectionMode.value === 'folder') {
                // Obtener lista de carpetas
                const folders = ['manifest', ...fs.readdirSync(manifestFolder)
                    .filter(item => {
                        try {
                            return fs.statSync(path.join(manifestFolder, item)).isDirectory();
                        } catch (error) {
                            return false;
                        }
                    })];

                const selectedFolder = await vscode.window.showQuickPick(folders, {
                    placeHolder: 'Selecciona la carpeta que contiene los archivos a combinar'
                });

                if (!selectedFolder) return;

                const folderPath = selectedFolder === 'manifest' 
                    ? manifestFolder 
                    : path.join(manifestFolder, selectedFolder);

                // Leer todos los XML de la carpeta seleccionada
                xmlFiles = fs.readdirSync(folderPath)
                    .filter(file => file.endsWith('.xml'))
                    .map(file => path.join(folderPath, file));

                if (xmlFiles.length < 2) {
                    vscode.window.showInformationMessage('Se necesitan al menos 2 archivos XML en la carpeta para combinar');
                    return;
                }
            } else {
                // Modo selección de archivos individual (código existente)
                const processDirectory = (dir: string) => {
                    const items = fs.readdirSync(dir);
                    items.forEach(item => {
                        const fullPath = path.join(dir, item);
                        if (fs.statSync(fullPath).isDirectory()) {
                            processDirectory(fullPath);
                        } else if (item.endsWith('.xml')) {
                            xmlFiles.push(fullPath);
                        }
                    });
                };
                processDirectory(manifestFolder);

                const fileItems = xmlFiles.map(file => ({
                    label: path.relative(manifestFolder, file),
                    path: file
                }));

                const selectedFiles = await vscode.window.showQuickPick(fileItems, {
                    canPickMany: true,
                    placeHolder: 'Selecciona los archivos package.xml a combinar'
                });

                if (!selectedFiles || selectedFiles.length < 2) {
                    vscode.window.showInformationMessage('Debes seleccionar al menos 2 archivos para combinar');
                    return;
                }

                xmlFiles = selectedFiles.map(file => file.path);
            }

            // Leer y combinar los archivos
            const xmlContents = xmlFiles.map(file => fs.readFileSync(file, 'utf8'));
            const mergedContent = mergePackageXmls(xmlContents);

            // Solicitar nombre del archivo
            const defaultFileName = `merged-package-${new Date().toISOString().replace(/[:.]/g, '-')}.xml`;
            const fileName = await vscode.window.showInputBox({
                prompt: 'Ingresa el nombre para el archivo combinado',
                placeHolder: 'Ejemplo: merged-feature-123.xml',
                value: defaultFileName
            });

            if (!fileName) {
                return;
            }

            // Asegurar que el archivo termine en .xml
            const finalFileName = fileName.endsWith('.xml') ? fileName : `${fileName}.xml`;
            const newFilePath = path.join(manifestFolder, finalFileName);

            fs.writeFileSync(newFilePath, mergedContent);
            vscode.window.showInformationMessage(`Archivos combinados en: ${finalFileName}`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
            vscode.window.showErrorMessage(`Error al combinar archivos: ${errorMessage}`);
        }
    });

    let gitChangesCommand = vscode.commands.registerCommand('extension.buildPackageFromGit', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No se encontró la carpeta del workspace');
            return;
        }
        await buildPackageFromGitChanges(workspaceFolder);
    });

    context.subscriptions.push(disposable, configCommand, mergeCommand, gitChangesCommand);
}