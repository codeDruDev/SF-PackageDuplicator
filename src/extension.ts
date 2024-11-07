import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

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
            // Obtener lista de carpetas y añadir la opción de manifest
            const folders = ['manifest', ...fs.readdirSync(manifestFolder)
                .filter(item => {
                    try {
                        return fs.statSync(path.join(manifestFolder, item)).isDirectory();
                    } catch (error) {
                        return false;
                    }
                })];

            if (folders.length === 0) {
                vscode.window.showErrorMessage('No se encontraron carpetas disponibles.');
                return;
            }
            
            const selectedFolder = await vscode.window.showQuickPick(folders, {
                placeHolder: 'Selecciona la carpeta destino'
            });

            if (!selectedFolder) {
                return;
            }

            // Obtener configuración del proyecto
            const config = await getProjectConfig(workspaceFolder);

            // Crear nuevo nombre de archivo con la configuración
            const newFileName = `${config.prefix}${ticketNumber}${config.suffix}.xml`;
            // Si es 'manifest', guardamos directamente en la carpeta manifest
            const targetPath = selectedFolder === 'manifest' 
                ? path.join(manifestFolder, newFileName)
                : path.join(manifestFolder, selectedFolder, newFileName);

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

    context.subscriptions.push(disposable, configCommand);
}