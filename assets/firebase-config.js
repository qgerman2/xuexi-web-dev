/* Configuración de Firebase · Xuexi Club UC
 *
 * Estos valores son PÚBLICOS a propósito. A diferencia de una contraseña, la
 * clave web de Firebase está pensada para viajar dentro de la página: sirve
 * para identificar el proyecto, no para autorizar nada.
 *
 * Lo que realmente protege los datos son las reglas de Firestore
 * (ver firestore.rules) y la configuración de Firebase Authentication.
 * Por eso publicar este archivo no es un riesgo, pero dejar las reglas
 * abiertas sí lo sería.
 *
 * ESTA COPIA ES LA DE DESARROLLO: apunta siempre a xuexi-sandbox-01, el
 * proyecto de pruebas. Nunca al del club. No hay condicional por hostname a
 * propósito — si este archivo acaba en producción, falla a lo seguro (datos de
 * mentira) en vez de escribir en los de verdad.
 *
 * Los valores salen de:
 *   npx firebase-tools apps:sdkconfig WEB --project xuexi-sandbox-01
 */
(function() {
  var firebaseConfig = {
    apiKey: "AIzaSyCn6585qISodF-1DLx7fhC0eXhnn364xzc",
    authDomain: "xuexi-sandbox-01.firebaseapp.com",
    projectId: "xuexi-sandbox-01",
    storageBucket: "xuexi-sandbox-01.firebasestorage.app",
    messagingSenderId: "432108188801",
    appId: "1:432108188801:web:36623ff05287a063ef8980"
  };

  var incompleta = Object.keys(firebaseConfig).some(function(k){
    return String(firebaseConfig[k]).indexOf('FALTA_') === 0;
  });

  if (incompleta) {
    // Sin configuración no se inicializa nada: el acceso de miembros queda
    // cerrado en vez de caer a un modo inseguro.
    console.warn('Firebase sin configurar: el acceso de miembros está desactivado. ' +
                 'Completa assets/firebase-config.js');
  } else if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  window.XUEXI_FIREBASE_CONFIG = firebaseConfig;
})();
