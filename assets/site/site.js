// Site de vendas do Chati: menu do celular, efeitos leves e contato.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const ano = $('#ano');
  if (ano) ano.textContent = new Date().getFullYear();

  // Menu do celular
  const btn = $('#btn-menu');
  const fechar = () => { document.body.classList.remove('menu-aberto'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', () => {
    const aberto = document.body.classList.toggle('menu-aberto');
    btn.setAttribute('aria-expanded', String(aberto));
  });
  document.querySelectorAll('#nav a').forEach((a) => a.addEventListener('click', fechar));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });

  // Topo com borda ao rolar
  const topo = $('#topo');
  const aoRolar = () => topo.classList.toggle('rolou', window.scrollY > 10);
  addEventListener('scroll', aoRolar, { passive: true }); aoRolar();

  // Entrada suave dos blocos
  if ('IntersectionObserver' in window) {
    const alvos = document.querySelectorAll('.secao h2, .card, .dor-item, .moldura, .fluxo li, .ia-col, .painel, .form, .numeros');
    const obs = new IntersectionObserver((itens) => itens.forEach((i) => {
      if (i.isIntersecting) { i.target.classList.add('visivel'); obs.unobserve(i.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    alvos.forEach((el) => { el.classList.add('surge'); obs.observe(el); });
  }

  // Contato: monta um e-mail pronto com os dados preenchidos
  const form = $('#form-contato');
  const msg = $('.form-msg', form);
  const zap = form.whatsapp;
  zap.addEventListener('input', () => {
    const d = zap.value.replace(/\D/g, '').slice(0, 11);
    if (d.length > 2) zap.value = `(${d.slice(0, 2)}) ${d.length > 7 ? `${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.slice(2)}`;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    msg.className = 'form-msg'; msg.textContent = '';
    form.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
    const falha = (campo, texto) => { campo.setAttribute('aria-invalid', 'true'); campo.focus(); msg.className = 'form-msg erro'; msg.textContent = texto; };
    if (form.nome.value.trim().length < 2) return falha(form.nome, 'Informe seu nome.');
    const dig = zap.value.replace(/\D/g, '');
    if (dig.length < 10 || dig.length > 13) return falha(zap, 'Informe seu WhatsApp com DDD.');
    const linhas = [
      `Nome: ${form.nome.value.trim()}`,
      form.empresa.value.trim() && `Loja: ${form.empresa.value.trim()}`,
      `WhatsApp: ${zap.value}`,
      form.contas.value && `Contas no Mercado Livre: ${form.contas.value}`,
      form.mensagem.value.trim() && `\n${form.mensagem.value.trim()}`,
    ].filter(Boolean).join('\n');
    const destino = form.dataset.email;
    location.href = `mailto:${destino}?subject=${encodeURIComponent('Quero conhecer o Chati')}&body=${encodeURIComponent(linhas)}`;
    msg.className = 'form-msg ok';
    msg.textContent = `Abrimos seu e-mail com a mensagem pronta. Se não abriu, escreva para ${destino}.`;
  });
})();
