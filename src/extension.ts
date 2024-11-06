import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
        console.error('Error al revertir package.xml:', error);
        vscode.window.showErrorMessage('Error al intentar revertir package.xml');
    }
}

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('extension.duplicatePackage', async () => {
        // Pedir número de ticket
        const ticketNumber = await vscode.window.showInputBox({
            prompt: 'Ingresa el número de ticket',
            placeHolder: 'Ejemplo: 1234'
        });

        if (!ticketNumber) {
            return;
        }

        // Obtener el archivo activo
        const activeFile = vscode.window.activeTextEditor?.document.uri;
        if (!activeFile) {
            vscode.window.showErrorMessage('No hay archivo activo');
            return;
        }

        // Encontrar la carpeta manifest
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeFile);
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No se encontró la carpeta del workspace');
            return;
        }

        const manifestFolder = path.join(workspaceFolder.uri.fsPath, 'manifest');
        
        // Mostrar selector de carpeta dentro de manifest
        const folders = fs.readdirSync(manifestFolder)
            .filter(item => fs.statSync(path.join(manifestFolder, item)).isDirectory());
        
        const selectedFolder = await vscode.window.showQuickPick(folders, {
            placeHolder: 'Selecciona la carpeta destino'
        });

        if (!selectedFolder) {
            return;
        }

        // Crear nuevo nombre de archivo
        const newFileName = `CRMLEAD000${ticketNumber}.xml`;
        const targetPath = path.join(manifestFolder, selectedFolder, newFileName);

        try {
            // Copiar archivo
            fs.copyFileSync(activeFile.fsPath, targetPath);
            
            // Revertir package.xml si hay cambios
            await revertPackageXmlIfChanged(workspaceFolder.uri.fsPath);

            vscode.window.showInformationMessage(`Archivo duplicado como ${newFileName}`);
        } catch (error) {
            vscode.window.showErrorMessage('Error al duplicar el archivo');
        }
    });

    context.subscriptions.push(disposable);
}