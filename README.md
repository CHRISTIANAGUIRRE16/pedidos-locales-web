# Panel web administrador

Este panel es independiente de la app móvil Expo. No modifica el APK ni el flujo de clientes/negocios.

## Seguridad

- Usa Firebase Authentication.
- Solo permite entrar si `users/{uid}.role` es `admin`.
- La protección real sigue en `firestore.rules` con `isAdmin()`.
- Las credenciales Firebase del archivo web son públicas por diseño; no son una clave secreta.
- Los pedidos llegan en vivo al panel.
- Desde web se puede coordinar, cancelar y marcar entregado.
- Al entregar, el panel permite asignar puntos y confirmar individualmente si cada promoción o recompensa fue entregada.
- Al cancelar, el panel resuelve promociones y canjes pendientes como no entregados.

## Incluye

- Resumen general.
- Listado de pedidos en vivo con coordinación por WhatsApp.
- Entrega de pedidos con puntos, promociones y recompensas.
- Cancelación de pedidos con resolución de canjes/promos.
- Listado de negocios y dueños.
- Listado de clientes.
- Solicitudes de negocio con generación de código.
- Solicitudes de eliminación de cuenta y negocio con generación de código.
- Solicitudes de promociones y recompensas con generación de código, rechazo o cancelación.

## Probar localmente

Desde esta carpeta puedes abrir `index.html` directamente en el navegador.

Si el navegador bloquea módulos por abrir archivo local, usa un servidor estático:

```powershell
cd "C:\Users\ckevi\Documents\Codex\2026-07-03\prompt-para-crear-una-aplicaci-n\admin-web"
$node = "C:\Users\ckevi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $node -e "require('http').createServer((req,res)=>{const fs=require('fs');const path=require('path');let file=req.url==='/'?'index.html':req.url.slice(1);let full=path.join(process.cwd(),file);fs.readFile(full,(e,d)=>{if(e){res.writeHead(404);res.end('No encontrado');return;}res.end(d);});}).listen(4173,()=>console.log('Panel en http://localhost:4173'))"
```

## Publicar

Se puede publicar en Firebase Hosting, GitHub Pages o cualquier hosting estático. Antes de hacerlo conviene agregar reglas de dominio autorizado en Firebase Authentication.
