// Vista Bay hesap sunucusunun adresi.
// Boş bırakılırsa oyunla aynı adres kullanılır (server/server.js oyunu da yayınlıyorsa bu yeterli).
// GitHub Pages sadece statik dosya yayınlar: server/server.js'i bir Node sunucusuna (Render, Railway, Fly.io, VPS…)
// kur ve adresini buraya yaz, örn: window.VB_API = 'https://vista-bay-api.onrender.com';
window.VB_API = window.VB_API ?? 'https://vista-bay-api.serli-omer2.workers.dev';
