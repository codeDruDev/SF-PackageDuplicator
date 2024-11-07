# SF Package Duplicator

Una extensión de Visual Studio Code diseñada para optimizar el flujo de trabajo con archivos package.xml en proyectos Salesforce.

## Características

- 📦 Duplicación automática de package.xml
- 🎯 Generación de nombres personalizables por proyecto
- 📁 Selector de carpeta destino
- 🔄 Restauración automática del package.xml original
- ⚙️ Configuración por workspace

## Instalación

1. Descarga el archivo `.vsix`
2. En VS Code, presiona `Ctrl+Shift+P` (o `Cmd+Shift+P` en Mac)
3. Busca "Extensions: Install from VSIX"
4. Selecciona el archivo descargado

## Uso

### Duplicar Package
1. Abre el archivo `manifest/package.xml`
2. Realiza tus modificaciones
3. Presiona `Ctrl+Shift+P`
4. Ejecuta `SF: Duplicate Package`
5. Ingresa el número de ticket
6. Selecciona la carpeta destino

### Configurar Formato de Archivo
1. Presiona `Ctrl+Shift+P`
2. Ejecuta `SF: Configure Package Duplicator`
3. Configura:
   - Prefijo (ej: "CRMLEAD000")
   - Sufijo (opcional)

## Ejemplos de Configuración

- **Configuración Estándar**:
  - Prefijo: "CRMLEAD000"
  - Resultado: `CRMLEAD000123.xml`

- **Con Sufijo**:
  - Prefijo: "TICKET-"
  - Sufijo: "-SFDC"
  - Resultado: `TICKET-123-SFDC.xml`

## Requisitos

- Visual Studio Code 1.93.0 o superior
- Git instalado en el sistema

## Configuración por Workspace

La extensión guarda la configuración por workspace, permitiendo diferentes formatos de nombre para distintos proyectos.

## Contribuir

Las contribuciones son bienvenidas. Por favor, abre un issue o pull request en el [repositorio](https://github.com/codeDruDev/SF-PackageDuplicator).

## Licencia

[MIT](LICENSE)