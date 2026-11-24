// =============================================================
//  FUNÇÕES USADAS EM TODAS AS PÁGINAS
// =============================================================
const $ = (id) => document.getElementById(id);
const dinheiro = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Mostra a foto do produto (pasta "imagem"); se não tiver foto, mostra o emoji
const figura = (p) => p.foto
  ? `<img src="${esc(p.foto)}" alt="${esc(p.nome)}" loading="lazy">`
  : esc(p.imagem);

let usuarioAtual = null;

// Faz uma chamada para a API e já devolve o JSON
async function api(url, metodo = 'GET', corpo) {
  const opcoes = { method: metodo, headers: {} };
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  const resposta = await fetch(url, opcoes);
  const dados = await resposta.json().catch(() => ({}));
  return { ok: resposta.ok, status: resposta.status, dados };
}

// Descobre quem está logado e desenha o menu do topo
async function carregarUsuario() {
  try {
    const { dados } = await api('/api/eu');
    usuarioAtual = dados.usuario || null;
  } catch {
    usuarioAtual = null;
  }
  desenharMenu();
  return usuarioAtual;
}

function desenharMenu() {
  const menu = $('menuUsuario');
  if (!menu) return;
  if (usuarioAtual) {
    menu.innerHTML = `
      <a href="pedido.html">Meus pedidos</a>
      ${usuarioAtual.tipo === 'admin' ? '<a href="admin.html">Painel</a>' : ''}
      <a href="perfil.html">Meu perfil</a>
      <a href="#" id="sair">Sair</a>`;
  } else {
    menu.innerHTML = `<a href="login.html">Entrar</a><a href="login.html#cadastro" class="esconder-celular">Criar conta</a>`;
  }
}

document.addEventListener('click', async (e) => {
  if (e.target.id !== 'sair') return;
  e.preventDefault();
  await api('/api/logout', 'POST');
  location.href = 'index.html';
});

// Manda para a tela de login e depois volta para a página atual
function irParaLogin() {
  const voltar = location.pathname.split('/').pop() + location.search;
  location.href = `login.html?voltar=${encodeURIComponent(voltar)}`;
}
