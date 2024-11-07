# SF Package Duplicator

## 🎯 Descripción
Extensión de VS Code para automatizar la gestión de archivos package.xml en proyectos Salesforce.

## ✨ Características

### 📦 Duplicación de Packages
- Duplica package.xml con un solo comando
- Nombrado automático con formato configurable (default: CRMLEAD000XXX.xml)
- Selector de carpeta destino
- Creación de subcarpetas al vuelo
- Restauración automática del package.xml original

### 🔄 Combinación de Packages
- Combina múltiples package.xml en uno solo
- Dos modos de selección:
  - Por carpeta: fusiona todos los XML de una carpeta
  - Manual: selección específica de archivos
- Nombre personalizable para el archivo resultante
- Elimina automáticamente elementos duplicados

### ⚙️ Configuración
- Prefijo personalizable por proyecto
- Sufijo opcional configurable
- Configuración independiente por workspace

## 🚀 Instalación

1. Descarga la última versión desde [GitHub Releases](https://github.com/codeDruDev/SF-PackageDuplicator/releases/tag/1.1.2)
2. Instala el archivo .vsix en VS Code
3. Recarga VS Code

## 📝 Uso

### Duplicar Package
1. Abre el comando palette (Ctrl/Cmd + Shift + P)
2. Ejecuta `SF: Duplicate Package`
3. Ingresa el número de ticket
4. Selecciona o crea la carpeta destino

### Combinar Packages
1. Abre el comando palette
2. Ejecuta `SF: Merge Packages`
3. Elige modo de selección (carpeta o archivos)
4. Selecciona los archivos a combinar
5. Define el nombre del archivo resultante

### Configurar
1. Ejecuta `SF: Configure Package Duplicator`
2. Define el prefijo y sufijo deseados

## ⚙️ Configuración

```json
{
    "packageDuplicator.filePrefix": "CRMLEAD000",
    "packageDuplicator.fileSuffix": ""
}
```

## 📋 Requisitos
- VS Code 1.80.0 o superior
- Git (recomendado)

## 🤝 Contribuir
¿Tienes ideas para mejorar la extensión? ¡Las contribuciones son bienvenidas!

1. Fork el repositorio
2. Crea una rama para tu feature
3. Envía un pull request

## 📄 Licencia
MIT License - ver [LICENSE](LICENSE) para más detalles.