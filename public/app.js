// =============================================================
//  PÁGINA INICIAL — cardápio, carrinho e finalização do pedido
// =============================================================
let produtos = [];
let categorias = [];
let cidades = [];          // cidades atendidas, cada uma com sua taxa de entrega
let cidadeEscolhida = null; // id da cidade de entrega
let categoriaAtiva = 'todas';
let carrinho = carregarCarrinho(); // [{ id, quantidade }]
let etapa = 'carrinho';            // 'carrinho' ou 'finalizar'
// ($, dinheiro, esc, api e usuarioAtual vêm do arquivo comum.js)

// ---------- Guardar carrinho no navegador ----------
function carregarCarrinho() {
  try { return JSON.parse(localStorage.getItem('carrinho')) || []; } catch { return []; }
}
function salvarCarrinho() {
  try { localStorage.setItem('carrinho', JSON.stringify(carrinho)); } catch {}
  atualizarContador();
}

// ---------- Buscar dados do servidor ----------
async function iniciar() {
  const [resCat, resProd, resCid] = await Promise.all([
    api('/api/categorias'),
    api('/api/produtos'),
    api('/api/cidades'),
    carregarUsuario(),
  ]);
  categorias = resCat.dados;
  produtos = resProd.dados;
  cidades = resCid.dados;
  cidadeEscolhida = usuarioAtual?.cidade_id || null;

  desenharTempoEntrega();
  desenharSaudacao();

  // tira do carrinho produtos que não existem mais (ou com opção que não existe mais)
  carrinho = carrinho.filter((item) => {
    const p = produtos.find((x) => x.id === item.id);
    if (!p) return false;
    return p.opcoes.length ? p.opcoes.includes(item.opcao) : true;
  });
  salvarCarrinho();

  desenharCategorias();
  desenharCardapio();

  // voltou do login com o carrinho cheio? já abre para finalizar
  if (new URLSearchParams(location.search).get('finalizar') && carrinho.length > 0 && usuarioAtual) {
    abrirGaveta();
    etapa = 'finalizar';
    desenharGaveta();
    history.replaceState(null, '', 'index.html');
  }
}

// ---------- Saudação grande no banner: "Olá, Thiago! 👋" ----------
function desenharSaudacao() {
  if (!usuarioAtual) { $('saudacao').hidden = true; return; }
  const primeiroNome = usuarioAtual.nome.split(' ')[0];
  const hora = new Date().getHours();
  const periodo = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  $('saudacao').innerHTML = `
    <a class="saudacao-avatar" href="perfil.html" title="Meu perfil">${esc(primeiroNome.charAt(0).toUpperCase())}</a>
    <div class="saudacao-texto">
      <small>${periodo}! Que bom te ver 💛</small>
      <strong>Olá, ${esc(primeiroNome)}! <span class="mao">👋</span></strong>
    </div>`;
  $('saudacao').hidden = false;
}

// ---------- Tempo e taxa de entrega no banner (cada cidade tem os seus) ----------
function desenharTempoEntrega() {
  const minha = cidades.find((c) => c.id == usuarioAtual?.cidade_id);
  // logado com cidade: mostra o tempo e a taxa da cidade dele;
  // senão, o cliente toca no selo e vê a tabela de todas as cidades
  $('seloTempo').innerHTML = minha
    ? `⏱️ ${esc(minha.tempo_entrega)} para ${esc(minha.nome)} <span class="seta-selo">▾</span>`
    : `⏱️ Tempo de entrega por cidade <span class="seta-selo">▾</span>`;
  $('seloEntrega').innerHTML = minha
    ? `🛵 Entrega para ${esc(minha.nome)}: ${dinheiro(minha.taxa_entrega)} <span class="seta-selo">▾</span>`
    : `🛵 Entrega para a sua cidade <span class="seta-selo">▾</span>`;

  $('tabelaCidades').innerHTML = `
    <p class="tabela-titulo">Tempo e taxa de entrega por cidade</p>
    ${cidades.map((c) => `
      <div class="linha-cidade ${c.id === minha?.id ? 'sua' : ''}">
        <strong>${esc(c.nome)}${c.id === minha?.id ? ' <small>(sua cidade)</small>' : ''}</strong>
        <span>⏱️ ${esc(c.tempo_entrega)}</span>
        <span>🛵 ${dinheiro(c.taxa_entrega)}</span>
      </div>`).join('')}`;
}
// Os dois selos (tempo e taxa) abrem e fecham a mesma tabela
function alternarTabelaCidades() {
  const abrir = $('tabelaCidades').hidden;
  $('tabelaCidades').hidden = !abrir;
  for (const id of ['seloTempo', 'seloEntrega']) {
    $(id).setAttribute('aria-expanded', abrir);
    $(id).classList.toggle('aberto', abrir);
  }
}
$('seloTempo').addEventListener('click', alternarTabelaCidades);
$('seloEntrega').addEventListener('click', alternarTabelaCidades);

// ---------- Cardápio ----------
function desenharCategorias() {
  const botoes = [
    { id: 'todas', nome: 'Todos', icone: '⭐' },
    ...categorias,
    { id: 'sobre', nome: 'Sobre nós', icone: '💛' },
  ];
  $('categorias').innerHTML = botoes.map((c) => `
    <button class="chip ${categoriaAtiva == c.id ? 'ativo' : ''} ${c.id === 'sobre' ? 'chip-sobre' : ''}" data-cat="${c.id}">
      ${c.icone} ${esc(c.nome)}
    </button>`).join('');
}

function desenharCardapio() {
  // aba "Sobre nós": esconde o cardápio e mostra o manual da marca
  const sobre = categoriaAtiva === 'sobre';
  $('sobre').hidden = !sobre;
  $('cardapio').hidden = sobre;
  if (sobre) return;

  const lista = categoriaAtiva === 'todas' ? categorias : categorias.filter((c) => c.id == categoriaAtiva);

  $('cardapio').innerHTML = lista.map((cat) => {
    const itens = produtos.filter((p) => p.categoria_id === cat.id);
    if (itens.length === 0) return '';
    return `
      <h2 class="secao-titulo">${cat.icone} ${esc(cat.nome)}</h2>
      <div class="grade">
        ${itens.map((p) => `
          <article class="produto">
            <div class="foto">${figura(p)}</div>
            <div class="info">
              <h3>${esc(p.nome)}</h3>
              <p class="descricao">${esc(p.descricao)}</p>
              <div class="rodape">
                <span class="preco">${dinheiro(p.preco)}</span>
                <button class="botao" data-adicionar="${p.id}">${p.opcoes.length ? 'Escolher' : 'Adicionar'}</button>
              </div>
            </div>
          </article>`).join('')}
      </div>`;
  }).join('');
}

function trocarCategoria(e) {
  const botao = e.target.closest('[data-cat]');
  if (!botao) return;
  categoriaAtiva = botao.dataset.cat;
  desenharCategorias();
  desenharCardapio();
  // se clicou no botão do fim da página "Sobre nós", volta para o topo das categorias
  if (e.currentTarget.id === 'sobre') $('categorias').scrollIntoView({ behavior: 'smooth' });
}
$('categorias').addEventListener('click', trocarCategoria);
$('sobre').addEventListener('click', trocarCategoria);

$('cardapio').addEventListener('click', (e) => {
  const botao = e.target.closest('[data-adicionar]');
  if (!botao) return;
  const produto = produtos.find((p) => p.id === Number(botao.dataset.adicionar));
  // Produto com opções (sabor, com/sem gás...) abre a janela de escolha
  if (produto.opcoes.length) abrirOpcoes(produto);
  else adicionar(produto.id);
});

// ---------- Janela de escolher opção ----------
let produtoEscolhendo = null;
let opcaoEscolhida = null;

function abrirOpcoes(produto) {
  produtoEscolhendo = produto;
  opcaoEscolhida = null;
  $('modalFoto').innerHTML = figura(produto);
  $('modalTitulo').textContent = produto.nome;
  $('modalPreco').textContent = dinheiro(produto.preco);
  $('modalPergunta').textContent = produto.nome === 'Água Mineral' ? 'Com ou sem gás?' : 'Escolha o sabor:';
  $('listaOpcoes').innerHTML = produto.opcoes.map((o) => `
    <label class="opcao">
      <input type="radio" name="opcao" value="${esc(o)}">
      <span>${esc(o)}</span>
    </label>`).join('');
  $('confirmarOpcao').disabled = true;
  $('confirmarOpcao').textContent = 'Escolha uma opção';
  $('modalOpcao').hidden = false;
}

function fecharOpcoes() {
  $('modalOpcao').hidden = true;
  produtoEscolhendo = null;
}

$('listaOpcoes').addEventListener('change', (e) => {
  opcaoEscolhida = e.target.value;
  $('confirmarOpcao').disabled = false;
  $('confirmarOpcao').textContent = `Adicionar ${opcaoEscolhida} · ${dinheiro(produtoEscolhendo.preco)}`;
});
$('confirmarOpcao').addEventListener('click', () => {
  if (!produtoEscolhendo || !opcaoEscolhida) return;
  adicionar(produtoEscolhendo.id, opcaoEscolhida);
  fecharOpcoes();
});
$('fecharOpcao').addEventListener('click', fecharOpcoes);
$('modalOpcao').addEventListener('click', (e) => { if (e.target.id === 'modalOpcao') fecharOpcoes(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modalOpcao').hidden) fecharOpcoes(); });

// ---------- Carrinho ----------
// Cada item do carrinho: { id, opcao, quantidade }
// O mesmo produto com opções diferentes vira itens separados (ex.: 1 Coca + 1 Pepsi)
function adicionar(id, opcao = null) {
  const item = carrinho.find((i) => i.id === id && (i.opcao || null) === opcao);
  if (item) item.quantidade++;
  else carrinho.push({ id, opcao, quantidade: 1 });
  salvarCarrinho();
  const produto = produtos.find((p) => p.id === id);
  mostrarAviso(`${produto.foto ? '✅' : produto.imagem} ${produto.nome}${opcao ? ` (${opcao})` : ''} adicionado!`);
  if ($('gaveta').classList.contains('aberta')) desenharGaveta();
}

function mudarQuantidade(indice, delta) {
  const item = carrinho[indice];
  if (!item) return;
  item.quantidade += delta;
  if (item.quantidade <= 0) carrinho.splice(indice, 1);
  salvarCarrinho();
  desenharGaveta();
}

function calcularSubtotal() {
  return carrinho.reduce((soma, item) => {
    const p = produtos.find((x) => x.id === item.id);
    return soma + (p ? p.preco * item.quantidade : 0);
  }, 0);
}

// Barra "Finalizar pedido" fixa embaixo: só aparece com algo no carrinho
function atualizarContador() {
  const quantidade = carrinho.reduce((s, i) => s + i.quantidade, 0);
  $('contador').textContent = quantidade;
  $('barraTotal').textContent = dinheiro(calcularSubtotal());
  $('barraCarrinho').hidden = quantidade === 0;
  document.body.classList.toggle('tem-barra', quantidade > 0);
  // "pulinho" na barra quando adiciona algo
  $('barraCarrinho').classList.remove('pulou');
  void $('barraCarrinho').offsetWidth;
  $('barraCarrinho').classList.add('pulou');
}

// Taxa da cidade escolhida (ou null se ainda não escolheu)
function taxaEntrega() {
  const cidade = cidades.find((c) => c.id == cidadeEscolhida);
  return cidade ? cidade.taxa_entrega : null;
}

function htmlTotais() {
  const subtotal = calcularSubtotal();
  const taxa = taxaEntrega();
  const cidade = cidades.find((c) => c.id == cidadeEscolhida);
  return `
    <div class="totais" id="totais">
      <div><span>Subtotal</span><span>${dinheiro(subtotal)}</span></div>
      <div>
        <span>Taxa de entrega${cidade ? ` <small>(${esc(cidade.nome)})</small>` : ''}</span>
        <span>${taxa === null ? '<small>escolha a cidade</small>' : dinheiro(taxa)}</span>
      </div>
      <div class="total"><span>Total</span><span>${dinheiro(subtotal + (taxa || 0))}</span></div>
      ${cidade ? `<p class="tempo-entrega">⏱️ Chega em <strong>${esc(cidade.tempo_entrega)}</strong></p>` : ''}
    </div>`;
}

function opcoesCidades() {
  return '<option value="">Selecione a cidade</option>' + cidades.map((c) => `
    <option value="${c.id}" ${c.id == cidadeEscolhida ? 'selected' : ''}>
      ${esc(c.nome)} — ${dinheiro(c.taxa_entrega)} · ${esc(c.tempo_entrega)}
    </option>`).join('');
}

function desenharGaveta() {
  if (carrinho.length === 0) {
    etapa = 'carrinho';
    $('tituloGaveta').textContent = 'Seu carrinho';
    $('conteudoGaveta').innerHTML = `
      <div class="vazio"><span class="emoji">🛒</span>Seu carrinho está vazio.<br>Escolha algo gostoso no cardápio!</div>`;
    return;
  }

  if (etapa === 'carrinho') {
    $('tituloGaveta').textContent = 'Seu carrinho';
    $('conteudoGaveta').innerHTML = carrinho.map((item, indice) => {
      const p = produtos.find((x) => x.id === item.id);
      return `
        <div class="item-carrinho">
          <span class="emoji">${figura(p)}</span>
          <div class="nome">${esc(p.nome)}
            ${item.opcao ? `<span class="opcao-item">${esc(item.opcao)}</span>` : ''}
            <small>${dinheiro(p.preco * item.quantidade)}</small></div>
          <div class="quantidade">
            <button data-menos="${indice}" aria-label="Diminuir">−</button>
            <strong>${item.quantidade}</strong>
            <button data-mais="${indice}" aria-label="Aumentar">+</button>
          </div>
        </div>`;
    }).join('') + htmlTotais() + `
      <button class="botao grande" id="irFinalizar">Ir para entrega e pagamento</button>`;
    return;
  }

  // etapa === 'finalizar'
  $('tituloGaveta').textContent = 'Finalizar pedido';

  // Precisa estar logado para pedir
  if (!usuarioAtual) {
    const voltar = encodeURIComponent('index.html?finalizar=1');
    $('conteudoGaveta').innerHTML = `
      <div class="aviso-login">
        <span class="emoji">🔐</span>
        <h3>Entre na sua conta</h3>
        <p>Para finalizar o pedido, entre ou crie uma conta. Seu carrinho fica guardado!</p>
        <a class="botao grande" href="login.html?voltar=${voltar}">Entrar</a>
        <a class="botao secundario grande" href="login.html?voltar=${voltar}#cadastro">Criar conta</a>
        <button class="botao secundario grande" type="button" id="voltarCarrinho" style="margin-top:8px">Voltar ao carrinho</button>
      </div>`;
    return;
  }

  $('conteudoGaveta').innerHTML = `
    <form class="formulario" id="formPedido">
      <h3>Entrega</h3>
      <div class="dados-entrega">
        <strong>${esc(usuarioAtual.nome)}</strong> · ${esc(usuarioAtual.telefone)}
      </div>
      <div class="campo"><label for="cidade">Cidade</label>
        <select id="cidade" required>${opcoesCidades()}</select></div>
      <div class="campo"><label for="endereco">Endereço (rua, número e bairro)</label>
        <input id="endereco" required value="${esc(usuarioAtual.endereco)}" placeholder="Ex.: Rua das Flores, 120 - Centro"></div>

      <h3>Pagamento</h3>
      <div class="opcoes-pagamento">
        <label><input type="radio" name="pagamento" value="Pix" checked><span>💠 Pix</span></label>
        <label><input type="radio" name="pagamento" value="Cartão na entrega"><span>💳 Cartão</span></label>
        <label><input type="radio" name="pagamento" value="Dinheiro"><span>💵 Dinheiro</span></label>
      </div>

      <div class="campo"><label for="observacao">Observação (opcional)</label>
        <textarea id="observacao" rows="2" placeholder="Ex.: sem cebola, troco para R$ 50"></textarea></div>

      ${htmlTotais()}
      <p class="erro" id="erroPedido"></p>
      <button class="botao grande" type="submit" id="botaoEnviar">Confirmar pedido</button>
      <button class="botao secundario grande" type="button" id="voltarCarrinho">Voltar ao carrinho</button>
    </form>`;
}

$('conteudoGaveta').addEventListener('click', (e) => {
  const mais = e.target.closest('[data-mais]');
  const menos = e.target.closest('[data-menos]');
  if (mais) mudarQuantidade(Number(mais.dataset.mais), +1);
  if (menos) mudarQuantidade(Number(menos.dataset.menos), -1);
  if (e.target.id === 'irFinalizar') { etapa = 'finalizar'; desenharGaveta(); }
  if (e.target.id === 'voltarCarrinho') { etapa = 'carrinho'; desenharGaveta(); }
});

// Trocou a cidade? Recalcula a taxa de entrega e o total
$('conteudoGaveta').addEventListener('change', (e) => {
  if (e.target.id !== 'cidade') return;
  cidadeEscolhida = e.target.value ? Number(e.target.value) : null;
  $('totais').outerHTML = htmlTotais();
});

// ---------- Enviar pedido para o servidor ----------
$('conteudoGaveta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const corpo = {
    itens: carrinho.map((i) => ({ produto_id: i.id, quantidade: i.quantidade, opcao: i.opcao || null })),
    endereco_entrega: $('endereco').value,
    cidade_id: Number($('cidade').value),
    forma_pagamento: document.querySelector('input[name="pagamento"]:checked').value,
    observacao: $('observacao').value,
  };

  $('botaoEnviar').disabled = true;
  $('erroPedido').textContent = '';

  try {
    const { ok, status, dados } = await api('/api/pedidos', 'POST', corpo);
    if (status === 401) return irParaLogin();
    if (!ok) throw new Error(dados.erro);

    carrinho = [];
    salvarCarrinho();
    window.location.href = `pedido.html?id=${dados.id}`;
  } catch (erro) {
    $('erroPedido').textContent = erro.message || 'Erro ao enviar o pedido.';
    $('botaoEnviar').disabled = false;
  }
});

// ---------- Abrir / fechar gaveta ----------
function abrirGaveta() {
  etapa = 'carrinho';
  desenharGaveta();
  $('gaveta').classList.add('aberta');
  $('fundoEscuro').classList.add('aberto');
}
function fecharGaveta() {
  $('gaveta').classList.remove('aberta');
  $('fundoEscuro').classList.remove('aberto');
}
$('abrirCarrinho').addEventListener('click', abrirGaveta);
$('fecharCarrinho').addEventListener('click', fecharGaveta);
$('fundoEscuro').addEventListener('click', fecharGaveta);

// ---------- Aviso rápido ----------
let tempoAviso;
function mostrarAviso(texto) {
  $('aviso').textContent = texto;
  $('aviso').classList.add('visivel');
  clearTimeout(tempoAviso);
  tempoAviso = setTimeout(() => $('aviso').classList.remove('visivel'), 1800);
}

iniciar();
