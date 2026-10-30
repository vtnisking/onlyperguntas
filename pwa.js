// Faz o Chati funcionar como app no celular/computador:
// ativa o service worker (sw.js), exigido para instalar o app e receber notificações.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((erro) => {
      console.warn("Não foi possível ativar o service worker:", erro);
    });
  });
}
