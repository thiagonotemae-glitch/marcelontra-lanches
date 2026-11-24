// =============================================================
//  SERVIDOR (Node.js + Express)
//  Entrega as páginas da pasta /public e responde a API (/api/...)
// =============================================================
const express = require('express');
const path = require('path');

// Lê as configurações do arquivo .env (e-mail remetente), se existir
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}

const db = require('./database');
const { gerarHash, conferirSenha, gerarToken, gerarCodigo, hashCodigo } = require('./auth');
const { enviarCodigo, testarConexao, EMAIL_CONFIGURADO } = require('./email');
const { PASTA: PASTA_FOTOS, comFotos } = require('./fotos');

const app = express();
const PORTA = Number(process.env.PORTA) || 3000;
// A taxa de entrega agora depende da cidade (tabela "cidades" no banco)
const STATUS_VALIDOS = ['Recebido', 'Em preparo', 'Saiu para entrega', 'Entregue', 'Cancelado'];
const PAGAMENTOS_VALIDOS = ['Pix', 'Cartão na entrega', 'Dinheiro'];
const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/imagem', express.static(PASTA_FOTOS)); // fotos dos produtos

const arredondar = (valor) => Math.round(valor * 100) / 100;
const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

// -------------------------------------------------------------
//  LOGIN: descobre quem está fazendo a requisição
//  O navegador guarda um cookie "sessao" com um token.
//  O token é procurado na tabela "sessoes" (JOIN com "usuarios").
// -------------------------------------------------------------
function lerCookie(req, nome) {
  const cookies = req.headers.cookie || '';
  for (const parte of cookies.split(';')) {
    const [chave, ...valor] = parte.trim().split('=');
    if (chave === nome) return decodeURIComponent(valor.join('='));
  }
  return null;
}

app.use((req, res, next) => {
  const token = lerCookie(req, 'sessao');
  req.usuario = token
    ? db.prepare(`
        SELECT u.id, u.nome, u.email, u.telefone, u.endereco, u.tipo,
               u.cidade_id, c.nome AS cidade, c.taxa_entrega, c.tempo_entrega
        FROM sessoes s
        JOIN usuarios u ON u.id = s.usuario_id
        LEFT JOIN cidades c ON c.id = u.cidade_id
        WHERE s.token = ?
      `).get(token) || null
    : null;
  next();
});

// Bloqueia quem não está logado
function exigirLogin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  next();
}

// Bloqueia quem não é administrador
function exigirAdmin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  if (req.usuario.tipo !== 'admin') return res.status(403).json({ erro: 'Acesso só para a lanchonete.' });
  next();
}

// Cria uma sessão no banco e manda o cookie para o navegador
function iniciarSessao(res, usuarioId) {
  const token = gerarToken();
  db.prepare('INSERT INTO sessoes (token, usuario_id) VALUES (?, ?)').run(token, usuarioId);
  res.cookie('sessao', token, { httpOnly: true, sameSite: 'lax', maxAge: SETE_DIAS });
}

// -------------------------------------------------------------
//  CADASTRO, LOGIN E LOGOUT
// -------------------------------------------------------------

app.post('/api/cadastro', async (req, res) => {
  const nome = texto(req.body.nome);
  const email = texto(req.body.email).toLowerCase();
  const telefone = texto(req.body.telefone);
  const endereco = texto(req.body.endereco);
  const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
  const cidade = buscarCidade(req.body.cidade_id);

  if (!nome || !email || !telefone || !endereco) {
    return res.status(400).json({ erro: 'Preencha todos os campos.' });
  }
  if (!cidade) {
    return res.status(400).json({ erro: 'Escolha uma cidade da lista.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'E-mail inválido.' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  }

  const existente = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (existente && existente.email_verificado) {
    return res.status(409).json({ erro: 'Já existe uma conta com esse e-mail.' });
  }

  let usuarioId;
  if (existente) {
    // Já tinha começado o cadastro mas não confirmou: atualiza os dados
    db.prepare(`
      UPDATE usuarios SET nome = ?, telefone = ?, endereco = ?, cidade_id = ?, senha_hash = ? WHERE id = ?
    `).run(nome, telefone, endereco, cidade.id, gerarHash(senha), existente.id);
    usuarioId = existente.id;
  } else {
    // A conta nasce com email_verificado = 0 (ainda não confirmada)
    usuarioId = Number(db.prepare(`
      INSERT INTO usuarios (nome, email, telefone, endereco, cidade_id, senha_hash) VALUES (?, ?, ?, ?, ?, ?)
    `).run(nome, email, telefone, endereco, cidade.id, gerarHash(senha)).lastInsertRowid);
  }

  try {
    const modo = await mandarNovoCodigo({ id: usuarioId, nome, email });
    res.status(201).json({ precisaVerificar: true, email, modo });
  } catch (erro) {
    console.error('Erro ao enviar e-mail:', erro.message);
    res.status(500).json({ erro: 'Não foi possível enviar o e-mail com o código. Tente de novo.' });
  }
});

// -------------------------------------------------------------
//  CÓDIGO DE CONFIRMAÇÃO POR E-MAIL
//  Fica na tabela "codigos_verificacao": vale 10 minutos
//  e permite no máximo 5 tentativas.
// -------------------------------------------------------------
const MAX_TENTATIVAS = 5;
const ESPERA_REENVIO = 60; // segundos entre um envio e outro

// tipo: 'cadastro' (confirmar e-mail), 'senha' (esqueci minha senha)
//       ou 'email' (trocar o e-mail: o código vai para o e-mail NOVO)
async function mandarNovoCodigo(usuario, tipo = 'cadastro', novoEmail = null) {
  const codigo = gerarCodigo();
  db.prepare('DELETE FROM codigos_verificacao WHERE usuario_id = ? AND tipo = ?').run(usuario.id, tipo);
  db.prepare(`
    INSERT INTO codigos_verificacao (usuario_id, tipo, codigo_hash, novo_email, expira_em)
    VALUES (?, ?, ?, ?, datetime('now', 'localtime', '+10 minutes'))
  `).run(usuario.id, tipo, hashCodigo(codigo), novoEmail);
  return enviarCodigo(novoEmail || usuario.email, usuario.nome, codigo, tipo);
}

// Quantos segundos faltam para poder pedir outro código (0 = já pode)
function segundosParaReenviar(usuarioId, tipo = 'cadastro') {
  const ultimo = db.prepare(`
    SELECT CAST(strftime('%s', 'now', 'localtime') - strftime('%s', criado_em) AS INTEGER) AS passou
    FROM codigos_verificacao WHERE usuario_id = ? AND tipo = ? ORDER BY id DESC LIMIT 1
  `).get(usuarioId, tipo);
  return ultimo ? Math.max(0, ESPERA_REENVIO - ultimo.passou) : 0;
}

// Pega o último código de um tipo e diz se já expirou
function ultimoCodigo(usuarioId, tipo) {
  return db.prepare(`
    SELECT *, (expira_em < datetime('now', 'localtime')) AS expirou
    FROM codigos_verificacao WHERE usuario_id = ? AND tipo = ? ORDER BY id DESC LIMIT 1
  `).get(usuarioId, tipo);
}

// Confere um código. Devolve null se estiver certo, ou { status, erro } se não
function conferirCodigo(registro, codigo) {
  if (!registro || registro.expirou) {
    return { status: 400, erro: 'O código expirou. Clique em "Reenviar código".' };
  }
  if (registro.tentativas >= MAX_TENTATIVAS) {
    return { status: 429, erro: 'Muitas tentativas erradas. Clique em "Reenviar código".' };
  }
  if (hashCodigo(codigo) !== registro.codigo_hash) {
    db.prepare('UPDATE codigos_verificacao SET tentativas = tentativas + 1 WHERE id = ?').run(registro.id);
    const restam = MAX_TENTATIVAS - registro.tentativas - 1;
    return {
      status: 400,
      erro: restam > 0 ? `Código incorreto. Você ainda tem ${restam} tentativa(s).` : 'Código incorreto. Clique em "Reenviar código".',
    };
  }
  return null;
}

const limparCodigo = (valor) => String(valor ?? '').replace(/\D/g, '');

app.post('/api/verificar', (req, res) => {
  const email = texto(req.body.email).toLowerCase();
  const codigo = limparCodigo(req.body.codigo);

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!usuario) return res.status(400).json({ erro: 'Código incorreto.' });
  if (usuario.email_verificado) return res.status(400).json({ erro: 'Esse e-mail já foi confirmado. Faça login.' });

  const problema = conferirCodigo(ultimoCodigo(usuario.id, 'cadastro'), codigo);
  if (problema) return res.status(problema.status).json({ erro: problema.erro });

  // Código certo: confirma o e-mail, apaga os códigos e já entra na conta
  db.prepare('UPDATE usuarios SET email_verificado = 1 WHERE id = ?').run(usuario.id);
  db.prepare("DELETE FROM codigos_verificacao WHERE usuario_id = ? AND tipo = 'cadastro'").run(usuario.id);
  iniciarSessao(res, usuario.id);
  res.json({ id: usuario.id, nome: usuario.nome, tipo: usuario.tipo });
});

app.post('/api/reenviar-codigo', async (req, res) => {
  const email = texto(req.body.email).toLowerCase();
  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!usuario || usuario.email_verificado) {
    return res.status(400).json({ erro: 'Não há cadastro pendente para esse e-mail.' });
  }
  const espera = segundosParaReenviar(usuario.id);
  if (espera > 0) {
    return res.status(429).json({ erro: `Aguarde ${espera} segundos para pedir outro código.`, espera });
  }
  try {
    const modo = await mandarNovoCodigo(usuario);
    res.json({ ok: true, modo });
  } catch (erro) {
    console.error('Erro ao enviar e-mail:', erro.message);
    res.status(500).json({ erro: 'Não foi possível enviar o e-mail. Tente de novo.' });
  }
});

// -------------------------------------------------------------
//  ESQUECI MINHA SENHA (3 passos)
//  1) /api/esqueci-senha            → confere se a conta existe e manda código
//  2) /api/esqueci-senha/verificar  → confere o código
//  3) /api/esqueci-senha/nova-senha → grava a senha nova no banco
// -------------------------------------------------------------

// Passo 1: a pessoa digita o e-mail
app.post('/api/esqueci-senha', async (req, res) => {
  const email = texto(req.body.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'Digite um e-mail válido.' });
  }

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!usuario) {
    return res.status(404).json({ erro: 'Não encontramos nenhuma conta com esse e-mail.' });
  }

  const espera = segundosParaReenviar(usuario.id, 'senha');
  if (espera > 0) {
    return res.status(429).json({ erro: `Aguarde ${espera} segundos para pedir outro código.`, espera });
  }

  try {
    const modo = await mandarNovoCodigo(usuario, 'senha');
    res.json({ ok: true, email, modo });
  } catch (erro) {
    console.error('Erro ao enviar e-mail:', erro.message);
    res.status(500).json({ erro: 'Não foi possível enviar o e-mail. Tente de novo.' });
  }
});

// Passo 2: a pessoa digita o código que chegou no e-mail
app.post('/api/esqueci-senha/verificar', (req, res) => {
  const email = texto(req.body.email).toLowerCase();
  const usuario = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (!usuario) return res.status(400).json({ erro: 'Código incorreto.' });

  const registro = ultimoCodigo(usuario.id, 'senha');
  const problema = conferirCodigo(registro, limparCodigo(req.body.codigo));
  if (problema) return res.status(problema.status).json({ erro: problema.erro });

  // Código certo: libera a troca de senha por mais 10 minutos
  db.prepare(`
    UPDATE codigos_verificacao
    SET confirmado = 1, expira_em = datetime('now', 'localtime', '+10 minutes')
    WHERE id = ?
  `).run(registro.id);
  res.json({ ok: true });
});

// Passo 3: a pessoa digita a senha nova (só funciona se o código foi confirmado)
app.post('/api/esqueci-senha/nova-senha', (req, res) => {
  const email = texto(req.body.email).toLowerCase();
  const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
  const codigo = limparCodigo(req.body.codigo);

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  const registro = usuario && ultimoCodigo(usuario.id, 'senha');
  if (!registro || registro.expirou || !registro.confirmado || hashCodigo(codigo) !== registro.codigo_hash) {
    return res.status(400).json({ erro: 'O tempo para trocar a senha acabou. Comece de novo em "Esqueci minha senha".' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  }
  if (conferirSenha(senha, usuario.senha_hash)) {
    return res.status(400).json({ erro: 'A nova senha precisa ser diferente da antiga.' });
  }

  db.exec('BEGIN');
  // Grava a senha nova (em hash). Como o código chegou no e-mail, ele também fica confirmado.
  db.prepare('UPDATE usuarios SET senha_hash = ?, email_verificado = 1 WHERE id = ?')
    .run(gerarHash(senha), usuario.id);
  // Desconecta a conta de todos os aparelhos e apaga os códigos usados
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(usuario.id);
  db.prepare('DELETE FROM codigos_verificacao WHERE usuario_id = ?').run(usuario.id);
  db.exec('COMMIT');

  iniciarSessao(res, usuario.id); // já entra com a senha nova
  res.json({ id: usuario.id, nome: usuario.nome, tipo: usuario.tipo });
});

app.post('/api/login', async (req, res) => {
  const email = texto(req.body.email).toLowerCase();
  const senha = typeof req.body.senha === 'string' ? req.body.senha : '';

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!usuario || !conferirSenha(senha, usuario.senha_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  }

  // Senha certa, mas ainda não confirmou o e-mail: manda um código novo
  if (!usuario.email_verificado) {
    let modo = EMAIL_CONFIGURADO ? 'email' : 'terminal';
    try {
      if (segundosParaReenviar(usuario.id) === 0) modo = await mandarNovoCodigo(usuario);
    } catch (erro) {
      console.error('Erro ao enviar e-mail:', erro.message);
    }
    return res.status(403).json({
      erro: 'Confirme seu e-mail para entrar.',
      precisaVerificar: true,
      email: usuario.email,
      modo,
    });
  }

  iniciarSessao(res, usuario.id);
  res.json({ id: usuario.id, nome: usuario.nome, tipo: usuario.tipo });
});

app.post('/api/logout', (req, res) => {
  const token = lerCookie(req, 'sessao');
  if (token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
  res.clearCookie('sessao');
  res.json({ ok: true });
});

// Quem está logado agora (ou null)
app.get('/api/eu', (req, res) => {
  res.json({ usuario: req.usuario });
});

// Meu perfil: dados da conta + resumo dos pedidos + avaliação (JOINs entre várias tabelas)
app.get('/api/perfil', exigirLogin, (req, res) => {
  const perfil = db.prepare(`
    SELECT u.nome, u.email, u.telefone, u.endereco, u.tipo, u.criado_em, u.email_verificado,
           c.nome AS cidade, c.taxa_entrega, c.tempo_entrega
    FROM usuarios u
    LEFT JOIN cidades c ON c.id = u.cidade_id
    WHERE u.id = ?
  `).get(req.usuario.id);

  perfil.pedidos = db.prepare(`
    SELECT COUNT(*) AS quantidade,
           COALESCE(SUM(CASE WHEN status <> 'Cancelado' THEN total ELSE 0 END), 0) AS total_gasto,
           MAX(criado_em) AS ultimo
    FROM pedidos
    WHERE usuario_id = ?
  `).get(req.usuario.id);

  // lanche que o cliente mais pediu
  perfil.favorito = db.prepare(`
    SELECT pr.nome, SUM(i.quantidade) AS vezes
    FROM itens_pedido i
    JOIN pedidos p   ON p.id = i.pedido_id
    JOIN produtos pr ON pr.id = i.produto_id
    WHERE p.usuario_id = ? AND p.status <> 'Cancelado'
    GROUP BY pr.id
    ORDER BY vezes DESC
    LIMIT 1
  `).get(req.usuario.id) || null;

  perfil.avaliacao = db.prepare('SELECT nota, comentario FROM avaliacoes WHERE usuario_id = ?')
    .get(req.usuario.id) || null;

  // troca de e-mail esperando o código (se tiver)
  const pendente = ultimoCodigo(req.usuario.id, 'email');
  perfil.email_pendente = pendente && !pendente.expirou ? pendente.novo_email : null;

  res.json(perfil);
});

// Editar perfil: nome, telefone, endereço e cidade (UPDATE na tabela usuarios)
app.put('/api/perfil', exigirLogin, (req, res) => {
  const nome = texto(req.body.nome);
  const telefone = texto(req.body.telefone);
  const endereco = texto(req.body.endereco);
  const cidade = buscarCidade(req.body.cidade_id);

  if (!nome || !telefone || !endereco) {
    return res.status(400).json({ erro: 'Preencha nome, telefone e endereço.' });
  }
  if (telefone.replace(/\D/g, '').length < 10) {
    return res.status(400).json({ erro: 'Telefone inválido. Coloque o DDD + número.' });
  }
  if (!cidade) {
    return res.status(400).json({ erro: 'Escolha uma cidade da lista.' });
  }

  db.prepare('UPDATE usuarios SET nome = ?, telefone = ?, endereco = ?, cidade_id = ? WHERE id = ?')
    .run(nome, telefone, endereco, cidade.id, req.usuario.id);
  res.json({ ok: true });
});

// -------------------------------------------------------------
//  TROCAR O E-MAIL (em 2 passos, para ter certeza que o e-mail novo é da pessoa)
//  1) /api/perfil/email           → confere a senha e manda um código pro e-mail NOVO
//  2) /api/perfil/email/confirmar → código certo? aí sim troca o e-mail no banco
// -------------------------------------------------------------
app.post('/api/perfil/email', exigirLogin, async (req, res) => {
  const email = texto(req.body.email).toLowerCase();
  const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'E-mail inválido.' });
  }
  if (email === usuario.email) {
    return res.status(400).json({ erro: 'Esse já é o seu e-mail.' });
  }
  if (!conferirSenha(senha, usuario.senha_hash)) {
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }
  if (db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email)) {
    return res.status(409).json({ erro: 'Já existe uma conta com esse e-mail.' });
  }
  const espera = segundosParaReenviar(usuario.id, 'email');
  if (espera > 0) {
    return res.status(429).json({ erro: `Aguarde ${espera} segundos para pedir outro código.`, espera });
  }

  try {
    const modo = await mandarNovoCodigo(usuario, 'email', email);
    res.json({ email, modo });
  } catch (erro) {
    console.error('Erro ao enviar e-mail:', erro.message);
    res.status(500).json({ erro: 'Não foi possível enviar o e-mail com o código. Confira o endereço.' });
  }
});

// Reenviar o código para o e-mail novo (não precisa digitar a senha de novo)
app.post('/api/perfil/email/reenviar', exigirLogin, async (req, res) => {
  const registro = ultimoCodigo(req.usuario.id, 'email');
  if (!registro) return res.status(400).json({ erro: 'Nenhuma troca de e-mail em andamento.' });
  const espera = segundosParaReenviar(req.usuario.id, 'email');
  if (espera > 0) {
    return res.status(429).json({ erro: `Aguarde ${espera} segundos para pedir outro código.`, espera });
  }
  try {
    const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
    const modo = await mandarNovoCodigo(usuario, 'email', registro.novo_email);
    res.json({ email: registro.novo_email, modo });
  } catch (erro) {
    console.error('Erro ao enviar e-mail:', erro.message);
    res.status(500).json({ erro: 'Não foi possível enviar o e-mail com o código.' });
  }
});

app.post('/api/perfil/email/confirmar', exigirLogin, (req, res) => {
  const registro = ultimoCodigo(req.usuario.id, 'email');
  const problema = conferirCodigo(registro, limparCodigo(req.body.codigo));
  if (problema) return res.status(problema.status).json({ erro: problema.erro });

  // alguém pode ter criado conta com esse e-mail enquanto isso
  if (db.prepare('SELECT id FROM usuarios WHERE email = ?').get(registro.novo_email)) {
    return res.status(409).json({ erro: 'Já existe uma conta com esse e-mail.' });
  }
  db.prepare('UPDATE usuarios SET email = ?, email_verificado = 1 WHERE id = ?').run(registro.novo_email, req.usuario.id);
  db.prepare("DELETE FROM codigos_verificacao WHERE usuario_id = ? AND tipo = 'email'").run(req.usuario.id);
  res.json({ email: registro.novo_email });
});

// Desistir da troca de e-mail
app.delete('/api/perfil/email', exigirLogin, (req, res) => {
  db.prepare("DELETE FROM codigos_verificacao WHERE usuario_id = ? AND tipo = 'email'").run(req.usuario.id);
  res.json({ ok: true });
});

// -------------------------------------------------------------
//  CIDADES ATENDIDAS (cada uma com sua taxa de entrega)
// -------------------------------------------------------------
function buscarCidade(id) {
  return db.prepare('SELECT * FROM cidades WHERE id = ?').get(Number(id) || 0) || null;
}

app.get('/api/cidades', (req, res) => {
  res.json(db.prepare('SELECT * FROM cidades ORDER BY taxa_entrega').all());
});

// -------------------------------------------------------------
//  CARDÁPIO
// -------------------------------------------------------------

// Lista as categorias
app.get('/api/categorias', (req, res) => {
  const categorias = db.prepare('SELECT * FROM categorias ORDER BY id').all();
  res.json(categorias);
});

// Coloca em cada produto a lista de opções dele (tabela "opcoes_produto")
// Ex.: Milkshake → ["Chocolate", "Morango", "Baunilha"]. Sem opções → []
function comOpcoes(lista) {
  const todas = db.prepare('SELECT produto_id, nome FROM opcoes_produto ORDER BY produto_id, ordem').all();
  for (const produto of lista) {
    produto.opcoes = todas.filter((o) => o.produto_id === produto.id).map((o) => o.nome);
  }
  return lista;
}

// Lista os produtos disponíveis, já com o nome da categoria (JOIN)
app.get('/api/produtos', (req, res) => {
  const produtos = db.prepare(`
    SELECT p.*, c.nome AS categoria
    FROM produtos p
    JOIN categorias c ON c.id = p.categoria_id
    WHERE p.disponivel = 1
    ORDER BY p.categoria_id, p.nome
  `).all();
  res.json(comOpcoes(comFotos(produtos)));
});

// -------------------------------------------------------------
//  PEDIDOS (cliente logado)
// -------------------------------------------------------------

// Cria um pedido novo
app.post('/api/pedidos', exigirLogin, (req, res) => {
  const { itens, forma_pagamento } = req.body;
  const observacao = texto(req.body.observacao);
  const endereco = texto(req.body.endereco_entrega) || req.usuario.endereco;
  const cidade = buscarCidade(req.body.cidade_id || req.usuario.cidade_id);

  // Validações
  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ erro: 'O carrinho está vazio.' });
  }
  if (!cidade) {
    return res.status(400).json({ erro: 'Escolha a cidade de entrega.' });
  }
  if (!PAGAMENTOS_VALIDOS.includes(forma_pagamento)) {
    return res.status(400).json({ erro: 'Forma de pagamento inválida.' });
  }

  const buscarProduto = db.prepare('SELECT * FROM produtos WHERE id = ? AND disponivel = 1');
  const buscarOpcoes = db.prepare('SELECT nome FROM opcoes_produto WHERE produto_id = ?');

  // O preço é sempre buscado no banco (o cliente não consegue "mudar" o preço)
  const itensValidados = [];
  for (const item of itens) {
    const produto = buscarProduto.get(item.produto_id);
    const quantidade = parseInt(item.quantidade, 10);
    if (!produto || !(quantidade > 0)) {
      return res.status(400).json({ erro: 'Um dos produtos não está mais disponível.' });
    }
    // Produto com opções (ex.: milkshake) precisa ter uma opção válida escolhida
    const opcoes = buscarOpcoes.all(produto.id).map((o) => o.nome);
    const opcao = opcoes.length ? texto(item.opcao) : null;
    if (opcoes.length && !opcoes.includes(opcao)) {
      return res.status(400).json({ erro: `Escolha uma opção para ${produto.nome}.` });
    }
    itensValidados.push({ produto, quantidade, opcao });
  }

  const subtotal = itensValidados.reduce((soma, i) => soma + i.produto.preco * i.quantidade, 0);
  const total = arredondar(subtotal + cidade.taxa_entrega);

  try {
    // TRANSAÇÃO: ou salva tudo (pedido + itens), ou não salva nada
    db.exec('BEGIN');

    // A taxa é copiada para o pedido: se a cidade mudar de preço depois,
    // os pedidos antigos continuam com o valor que o cliente pagou.
    const { lastInsertRowid: pedidoId } = db.prepare(`
      INSERT INTO pedidos (usuario_id, endereco_entrega, cidade_id, forma_pagamento, observacao, taxa_entrega, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.usuario.id, endereco, cidade.id, forma_pagamento, observacao || null, cidade.taxa_entrega, total);

    // Cliente antigo sem cidade cadastrada? Salva a cidade escolhida no perfil dele
    if (!req.usuario.cidade_id) {
      db.prepare('UPDATE usuarios SET cidade_id = ? WHERE id = ?').run(cidade.id, req.usuario.id);
    }

    const inserirItem = db.prepare(`
      INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario, opcao)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const { produto, quantidade, opcao } of itensValidados) {
      inserirItem.run(pedidoId, produto.id, quantidade, produto.preco, opcao);
    }

    db.exec('COMMIT');
    res.status(201).json({ id: Number(pedidoId), total });
  } catch (erro) {
    db.exec('ROLLBACK');
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível salvar o pedido.' });
  }
});

// Lista os pedidos do usuário logado
app.get('/api/meus-pedidos', exigirLogin, (req, res) => {
  const pedidos = db.prepare(`
    SELECT p.id, p.status, p.total, p.criado_em,
           (SELECT SUM(quantidade) FROM itens_pedido WHERE pedido_id = p.id) AS quantidade_itens
    FROM pedidos p
    WHERE p.usuario_id = ?
    ORDER BY p.id DESC
  `).all(req.usuario.id);
  res.json(pedidos);
});

// Mostra um pedido com os dados do cliente e os itens (JOIN entre tabelas)
app.get('/api/pedidos/:id', exigirLogin, (req, res) => {
  const pedido = db.prepare(`
    SELECT p.*, u.nome AS cliente_nome, u.telefone, c.nome AS cidade, c.tempo_entrega
    FROM pedidos p
    JOIN usuarios u ON u.id = p.usuario_id
    LEFT JOIN cidades c ON c.id = p.cidade_id
    WHERE p.id = ?
  `).get(req.params.id);

  // Cada cliente só vê os próprios pedidos (o admin vê todos)
  if (!pedido || (pedido.usuario_id !== req.usuario.id && req.usuario.tipo !== 'admin')) {
    return res.status(404).json({ erro: 'Pedido não encontrado.' });
  }

  pedido.itens = comFotos(db.prepare(`
    SELECT i.quantidade, i.preco_unitario, i.opcao, pr.nome, pr.imagem
    FROM itens_pedido i
    JOIN produtos pr ON pr.id = i.produto_id
    WHERE i.pedido_id = ?
  `).all(req.params.id));

  res.json(pedido);
});

// -------------------------------------------------------------
//  AVALIAÇÕES (avalie-nos)
// -------------------------------------------------------------

// Lista as avaliações (todos podem ver) + média e quantas de cada nota
app.get('/api/avaliacoes', (req, res) => {
  const resumo = db.prepare(`
    SELECT COUNT(*) AS total, ROUND(AVG(nota), 1) AS media,
           SUM(CASE WHEN nota = 5 THEN 1 ELSE 0 END) AS n5,
           SUM(CASE WHEN nota = 4 THEN 1 ELSE 0 END) AS n4,
           SUM(CASE WHEN nota = 3 THEN 1 ELSE 0 END) AS n3,
           SUM(CASE WHEN nota = 2 THEN 1 ELSE 0 END) AS n2,
           SUM(CASE WHEN nota = 1 THEN 1 ELSE 0 END) AS n1
    FROM avaliacoes
  `).get();

  // JOIN com usuarios para mostrar o nome de quem avaliou
  const lista = db.prepare(`
    SELECT a.nota, a.comentario, a.atualizado_em, a.usuario_id, u.nome
    FROM avaliacoes a
    JOIN usuarios u ON u.id = a.usuario_id
    ORDER BY a.atualizado_em DESC, a.id DESC
  `).all().map((a) => ({
    nome: a.nome.split(' ')[0],          // só o primeiro nome, por privacidade
    nota: a.nota,
    comentario: a.comentario,
    data: a.atualizado_em,
    minha: req.usuario ? a.usuario_id === req.usuario.id : false,
  }));

  res.json({ ...resumo, lista });
});

// Cria ou atualiza a avaliação do usuário logado (ON CONFLICT = se já existe, atualiza)
app.post('/api/avaliacoes', exigirLogin, (req, res) => {
  const nota = Number(req.body.nota);
  const comentario = String(req.body.comentario || '').trim().slice(0, 500);
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
    return res.status(400).json({ erro: 'Escolha de 1 a 5 estrelas.' });
  }
  db.prepare(`
    INSERT INTO avaliacoes (usuario_id, nota, comentario) VALUES (?, ?, ?)
    ON CONFLICT (usuario_id) DO UPDATE SET
      nota = excluded.nota,
      comentario = excluded.comentario,
      atualizado_em = datetime('now', 'localtime')
  `).run(req.usuario.id, nota, comentario);
  res.json({ ok: true });
});

// -------------------------------------------------------------
//  PAINEL DA LANCHONETE (somente admin)
// -------------------------------------------------------------
app.use('/api/admin', exigirAdmin);

// Lista todos os pedidos com nome do cliente e os itens
app.get('/api/admin/pedidos', (req, res) => {
  const pedidos = db.prepare(`
    SELECT p.*, u.nome AS cliente_nome, u.telefone, c.nome AS cidade,
           (SELECT GROUP_CONCAT(i.quantidade || 'x ' || pr.nome || COALESCE(' (' || i.opcao || ')', ''), ', ')
              FROM itens_pedido i JOIN produtos pr ON pr.id = i.produto_id
             WHERE i.pedido_id = p.id) AS resumo_itens
    FROM pedidos p
    JOIN usuarios u ON u.id = p.usuario_id
    LEFT JOIN cidades c ON c.id = p.cidade_id
    ORDER BY p.id DESC
  `).all();
  res.json(pedidos);
});

// Muda o status de um pedido
app.patch('/api/admin/pedidos/:id/status', (req, res) => {
  const { status } = req.body;
  if (!STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ erro: 'Status inválido.' });
  }
  const { changes } = db.prepare('UPDATE pedidos SET status = ? WHERE id = ?').run(status, req.params.id);
  if (changes === 0) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  res.json({ ok: true });
});

// Resumo / relatório (usa SUM, COUNT e GROUP BY)
app.get('/api/admin/resumo', (req, res) => {
  const geral = db.prepare(`
    SELECT COUNT(*) AS total_pedidos,
           COALESCE(SUM(total), 0) AS faturamento
    FROM pedidos WHERE status <> 'Cancelado'
  `).get();

  const clientes = db.prepare("SELECT COUNT(*) AS total FROM usuarios WHERE tipo = 'cliente'").get().total;

  const maisVendidos = db.prepare(`
    SELECT pr.nome, pr.imagem, SUM(i.quantidade) AS quantidade
    FROM itens_pedido i
    JOIN produtos pr ON pr.id = i.produto_id
    JOIN pedidos p ON p.id = i.pedido_id
    WHERE p.status <> 'Cancelado'
    GROUP BY pr.id
    ORDER BY quantidade DESC
    LIMIT 5
  `).all();

  res.json({ ...geral, faturamento: arredondar(geral.faturamento), clientes, maisVendidos: comFotos(maisVendidos) });
});

// Lista os clientes cadastrados e quantos pedidos cada um fez (LEFT JOIN + GROUP BY)
app.get('/api/admin/clientes', (req, res) => {
  const clientes = db.prepare(`
    SELECT u.id, u.nome, u.email, u.telefone, u.endereco, u.criado_em, u.email_verificado, c.nome AS cidade,
           COUNT(p.id) AS pedidos,
           COALESCE(SUM(CASE WHEN p.status <> 'Cancelado' THEN p.total END), 0) AS total_gasto
    FROM usuarios u
    LEFT JOIN cidades c ON c.id = u.cidade_id
    LEFT JOIN pedidos p ON p.usuario_id = u.id
    WHERE u.tipo = 'cliente'
    GROUP BY u.id
    ORDER BY u.id DESC
  `).all();
  res.json(clientes);
});

// Lista TODOS os produtos (inclusive indisponíveis)
app.get('/api/admin/produtos', (req, res) => {
  const produtos = db.prepare(`
    SELECT p.*, c.nome AS categoria
    FROM produtos p JOIN categorias c ON c.id = p.categoria_id
    ORDER BY p.categoria_id, p.nome
  `).all();
  res.json(comOpcoes(comFotos(produtos)));
});

// Cadastra um produto novo
app.post('/api/admin/produtos', (req, res) => {
  const { categoria_id, nome, descricao, preco, imagem } = req.body;
  const precoNumero = Number(preco);
  if (!texto(nome) || !(precoNumero >= 0) || !categoria_id) {
    return res.status(400).json({ erro: 'Preencha nome, categoria e preço.' });
  }
  try {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO produtos (categoria_id, nome, descricao, preco, imagem) VALUES (?, ?, ?, ?, ?)
    `).run(categoria_id, texto(nome), texto(descricao), arredondar(precoNumero), texto(imagem) || '🍽️');
    res.status(201).json({ id: Number(lastInsertRowid) });
  } catch (erro) {
    res.status(400).json({ erro: 'Categoria inválida.' });
  }
});

// Liga/desliga um produto do cardápio
app.patch('/api/admin/produtos/:id/disponivel', (req, res) => {
  const { disponivel } = req.body;
  db.prepare('UPDATE produtos SET disponivel = ? WHERE id = ?').run(disponivel ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// -------------------------------------------------------------
const servidor = app.listen(PORTA, () => {
  console.log(`Servidor rodando em http://localhost:${PORTA}`);
  console.log(`Painel da lanchonete: http://localhost:${PORTA}/admin.html`);

  // Endereço para abrir no celular (precisa estar no mesmo Wi-Fi/rede do computador)
  const enderecos = Object.entries(require('os').networkInterfaces())
    .filter(([nome]) => !/vpn|virtual|vethernet|loopback/i.test(nome))
    .flatMap(([, lista]) => lista)
    .filter((e) => e.family === 'IPv4' && !e.internal && !e.address.startsWith('169.254.'));
  for (const e of enderecos) console.log(`No celular (mesma rede Wi-Fi): http://${e.address}:${PORTA}`);
  if (EMAIL_CONFIGURADO) {
    console.log('E-mail: testando conexão com o Gmail...');
    testarConexao();
  } else {
    console.log('E-mail: NÃO configurado — os códigos vão aparecer aqui no terminal (veja o README).');
  }
});

servidor.on('error', (erro) => {
  if (erro.code === 'EADDRINUSE') {
    console.log(`\nA porta ${PORTA} já está em uso — o site provavelmente JÁ ESTÁ RODANDO.`);
    console.log(`Abra http://localhost:${PORTA} no navegador.`);
    console.log('Se quiser reiniciar, feche o outro terminal que está rodando o "npm start" (ou aperte Ctrl+C nele).\n');
    process.exit(1);
  }
  throw erro;
});
