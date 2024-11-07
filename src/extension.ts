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

    context.subscriptions.push(disposable, configCommand, mergeCommand);
}