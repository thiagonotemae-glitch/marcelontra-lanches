// =============================================================
//  BANCO DE DADOS (SQLite)
//  Usa o módulo "node:sqlite", que já vem embutido no Node.js.
//  O arquivo do banco é criado automaticamente: lanchonete.db
// =============================================================
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { gerarHash } = require('./auth');

// (a variável BANCO permite usar outro arquivo, por exemplo uma cópia para testes)
const db = new DatabaseSync(process.env.BANCO || path.join(__dirname, 'lanchonete.db'));

// Liga a verificação de chaves estrangeiras (as "ligações" entre tabelas)
db.exec('PRAGMA foreign_keys = ON;');

// Códigos enviados por e-mail. tipo:
//   'cadastro' = confirmar o e-mail da conta nova
//   'senha'    = esqueci minha senha
//   'email'    = trocar o e-mail no "Meu perfil" (o e-mail novo fica em novo_email)
const TABELA_CODIGOS = `
  CREATE TABLE IF NOT EXISTS codigos_verificacao (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id   INTEGER NOT NULL,
    tipo         TEXT NOT NULL DEFAULT 'cadastro' CHECK (tipo IN ('cadastro', 'senha', 'email')),
    codigo_hash  TEXT NOT NULL,
    novo_email   TEXT,
    expira_em    TEXT NOT NULL,
    tentativas   INTEGER NOT NULL DEFAULT 0,
    confirmado   INTEGER NOT NULL DEFAULT 0,
    criado_em    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );`;

// -------------------------------------------------------------
//  CRIAÇÃO DAS TABELAS
//
//  categorias 1 ──── N produtos
//  cidades    1 ──── N usuarios
//  cidades    1 ──── N pedidos
//  usuarios   1 ──── N sessoes
//  usuarios   1 ──── N pedidos
//  pedidos    1 ──── N itens_pedido N ──── 1 produtos
// -------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS categorias (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nome   TEXT NOT NULL UNIQUE,
    icone  TEXT
  );

  CREATE TABLE IF NOT EXISTS produtos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    categoria_id  INTEGER NOT NULL,
    nome          TEXT NOT NULL,
    descricao     TEXT,
    preco         REAL NOT NULL CHECK (preco >= 0),
    imagem        TEXT,
    disponivel    INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id)
  );

  CREATE TABLE IF NOT EXISTS cidades (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nome          TEXT NOT NULL UNIQUE,
    taxa_entrega  REAL NOT NULL CHECK (taxa_entrega >= 0),
    tempo_entrega TEXT NOT NULL DEFAULT '30–45 min'
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    telefone    TEXT NOT NULL,
    endereco    TEXT NOT NULL,
    cidade_id   INTEGER REFERENCES cidades(id),
    email_verificado INTEGER NOT NULL DEFAULT 0,
    senha_hash  TEXT NOT NULL,
    tipo        TEXT NOT NULL DEFAULT 'cliente' CHECK (tipo IN ('cliente', 'admin')),
    criado_em   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  ${TABELA_CODIGOS}

  CREATE TABLE IF NOT EXISTS sessoes (
    token       TEXT PRIMARY KEY,
    usuario_id  INTEGER NOT NULL,
    criado_em   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pedidos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id        INTEGER NOT NULL,
    status            TEXT NOT NULL DEFAULT 'Recebido',
    endereco_entrega  TEXT NOT NULL,
    cidade_id         INTEGER REFERENCES cidades(id),
    forma_pagamento   TEXT NOT NULL,
    observacao        TEXT,
    taxa_entrega      REAL NOT NULL DEFAULT 5,
    total             REAL NOT NULL,
    criado_em         TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS itens_pedido (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id       INTEGER NOT NULL,
    produto_id      INTEGER NOT NULL,
    quantidade      INTEGER NOT NULL CHECK (quantidade > 0),
    preco_unitario  REAL NOT NULL,
    opcao           TEXT,
    FOREIGN KEY (pedido_id)  REFERENCES pedidos(id) ON DELETE CASCADE,
    FOREIGN KEY (produto_id) REFERENCES produtos(id)
  );

  -- Opções que o cliente escolhe (ex.: sabor do milkshake, água com ou sem gás)
  CREATE TABLE IF NOT EXISTS opcoes_produto (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id  INTEGER NOT NULL,
    nome        TEXT NOT NULL,
    ordem       INTEGER NOT NULL DEFAULT 0,
    UNIQUE (produto_id, nome),
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
  );

  -- Avaliações da lanchonete (cada cliente tem UMA avaliação, que pode editar)
  CREATE TABLE IF NOT EXISTS avaliacoes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id     INTEGER NOT NULL UNIQUE,
    nota           INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
    comentario     TEXT NOT NULL DEFAULT '',
    criado_em      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    atualizado_em  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );
`);

// -------------------------------------------------------------
//  ATUALIZAÇÃO DE BANCO ANTIGO
//  Se o banco foi criado antes de existir a tabela "cidades",
//  adiciona a coluna cidade_id sem apagar os dados que já existem.
// -------------------------------------------------------------
function temColuna(tabela, coluna) {
  return db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
}
// A tabela de códigos antiga não aceitava o tipo 'email'. Como os códigos só
// valem 10 minutos, dá para apagar a tabela e criar de novo sem perder nada importante.
const sqlCodigos = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'codigos_verificacao'").get().sql;
if (!sqlCodigos.includes("'email'")) {
  db.exec('DROP TABLE codigos_verificacao');
  db.exec(TABELA_CODIGOS);
}
for (const tabela of ['usuarios', 'pedidos']) {
  if (!temColuna(tabela, 'cidade_id')) {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN cidade_id INTEGER REFERENCES cidades(id)`);
  }
}
if (!temColuna('usuarios', 'email_verificado')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN email_verificado INTEGER NOT NULL DEFAULT 0');
}
// tipo: 'cadastro' (confirmar e-mail) ou 'senha' (esqueci minha senha)
if (!temColuna('codigos_verificacao', 'tipo')) {
  db.exec("ALTER TABLE codigos_verificacao ADD COLUMN tipo TEXT NOT NULL DEFAULT 'cadastro'");
}
// confirmado: 1 quando o código de "esqueci minha senha" já foi digitado certo
if (!temColuna('codigos_verificacao', 'confirmado')) {
  db.exec('ALTER TABLE codigos_verificacao ADD COLUMN confirmado INTEGER NOT NULL DEFAULT 0');
}
// opcao: o que o cliente escolheu (ex.: "Chocolate"), guardado em cada item do pedido
if (!temColuna('itens_pedido', 'opcao')) {
  db.exec('ALTER TABLE itens_pedido ADD COLUMN opcao TEXT');
}

// -------------------------------------------------------------
//  CIDADES ATENDIDAS, TAXA E TEMPO DE ENTREGA
//  Para mudar uma taxa, um tempo ou adicionar cidade: altere a lista
//  abaixo e reinicie o servidor (Ctrl+C e "npm start"). Não apaga nada.
// -------------------------------------------------------------
// tempo_entrega: quanto tempo o pedido leva para chegar em cada cidade
if (!temColuna('cidades', 'tempo_entrega')) {
  db.exec("ALTER TABLE cidades ADD COLUMN tempo_entrega TEXT NOT NULL DEFAULT '30–45 min'");
}
const CIDADES = [
  // [nome,                 taxa, tempo de entrega]
  ['Várzea Paulista',       3.0,  '30–45 min'],
  ['Jundiaí',               5.5,  '50 min–1h'],
  ['Campo Limpo Paulista',  7.0,  'cerca de 1h10'],
  ['Jarinu',                9.0,  'cerca de 1h30'],
];
// Se a cidade não existe, cria; se já existe, atualiza a taxa e o tempo
const inserirCidade = db.prepare(`
  INSERT INTO cidades (nome, taxa_entrega, tempo_entrega) VALUES (?, ?, ?)
  ON CONFLICT(nome) DO UPDATE SET
    taxa_entrega = excluded.taxa_entrega,
    tempo_entrega = excluded.tempo_entrega
`);
for (const [nome, taxa, tempo] of CIDADES) inserirCidade.run(nome, taxa, tempo);

// -------------------------------------------------------------
//  DADOS INICIAIS (só insere se o banco estiver vazio)
// -------------------------------------------------------------
const { total } = db.prepare('SELECT COUNT(*) AS total FROM categorias').get();

if (total === 0) {
  const inserirCategoria = db.prepare('INSERT INTO categorias (nome, icone) VALUES (?, ?)');
  const inserirProduto = db.prepare(
    'INSERT INTO produtos (categoria_id, nome, descricao, preco, imagem) VALUES (?, ?, ?, ?, ?)'
  );

  const cardapio = [
    ['Lanches', '🍔', [
      ['X-Burguer', 'Pão, hambúrguer 150g, queijo e molho da casa', 18.9, '🍔'],
      ['X-Salada', 'Pão, hambúrguer 150g, queijo, alface, tomate e maionese', 21.9, '🥬'],
      ['X-Bacon', 'Pão, hambúrguer 150g, queijo, bacon crocante e cebola', 24.9, '🥓'],
      ['X-Tudo', 'Hambúrguer, ovo, bacon, presunto, queijo, salada e batata palha', 29.9, '🍳'],
      ['Cachorro-Quente', 'Pão, 1 salsicha, maionese, ketchup e mostarda', 15.9, '🌭'],
    ]],
    ['Porções', '🍟', [
      ['Batata Frita', 'Porção de 300g com sal e orégano', 16.9, '🍟'],
      ['Batata com Cheddar e Bacon', 'Porção de 300g coberta com cheddar e bacon', 24.9, '🧀'],
      ['Nuggets (12 un.)', 'Acompanha molho barbecue', 19.9, '🍗'],
      ['Onion Rings', 'Anéis de cebola empanados', 17.9, '🧅'],
    ]],
    ['Bebidas', '🥤', [
      ['Refrigerante Lata', 'Coca-Cola, Guaraná ou Pepsi — 350ml', 6.0, '🥤'],
      ['Suco Natural', 'Laranja, limão ou maracujá — 500ml', 9.9, '🧃'],
      ['Água Mineral', 'Com ou sem gás — 500ml', 4.0, '💧'],
      ['Milkshake', 'Chocolate, morango ou baunilha — 400ml', 16.9, '🥛'],
    ]],
    ['Sobremesas', '🍨', [
      ['Brownie', 'Brownie de chocolate com nozes', 11.9, '🍫'],
      ['Sorvete de Creme (3 bolas)', '3 bolas de sorvete de creme', 12.9, '🍨'],
      ['Churros', '3 unidades recheadas com doce de leite', 13.9, '🥐'],
    ]],
  ];

  db.exec('BEGIN');
  for (const [nomeCategoria, icone, produtos] of cardapio) {
    const { lastInsertRowid } = inserirCategoria.run(nomeCategoria, icone);
    for (const [nome, descricao, preco, imagem] of produtos) {
      inserirProduto.run(lastInsertRowid, nome, descricao, preco, imagem);
    }
  }
  db.exec('COMMIT');
  console.log('Banco criado e cardápio inicial cadastrado.');
}

// -------------------------------------------------------------
//  AJUSTES DO CARDÁPIO (para bancos que já existiam)
//  [nome antigo, nome novo, descrição nova]
// -------------------------------------------------------------
const AJUSTES = [
  ['Nuggets (10 un.)', 'Nuggets (12 un.)', 'Acompanha molho barbecue'],
  ['Sorvete (2 bolas)', 'Sorvete de Creme (3 bolas)', '3 bolas de sorvete de creme'],
  ['Refrigerante Lata', 'Refrigerante Lata', 'Coca-Cola, Guaraná ou Pepsi — 350ml'],
  ['Cachorro-Quente', 'Cachorro-Quente', 'Pão, 1 salsicha, maionese, ketchup e mostarda'],
];
for (const [antigo, novo, descricao] of AJUSTES) {
  db.prepare('UPDATE produtos SET nome = ?, descricao = ? WHERE nome = ?').run(novo, descricao, antigo);
}

// -------------------------------------------------------------
//  OPÇÕES DOS PRODUTOS (o cliente escolhe uma ao adicionar)
//  Para mudar: altere a lista e reinicie o servidor.
// -------------------------------------------------------------
const OPCOES = {
  'Milkshake': ['Chocolate', 'Morango', 'Baunilha'],
  'Refrigerante Lata': ['Coca-Cola', 'Guaraná', 'Pepsi'],
  'Suco Natural': ['Laranja', 'Limão', 'Maracujá'],
  'Água Mineral': ['Sem gás', 'Com gás'],
};
for (const [nomeProduto, opcoes] of Object.entries(OPCOES)) {
  const produto = db.prepare('SELECT id FROM produtos WHERE nome = ?').get(nomeProduto);
  if (!produto) continue;
  // apaga opções que saíram da lista (ex.: "Fanta") e grava as atuais na ordem certa
  const marcadores = opcoes.map(() => '?').join(', ');
  db.prepare(`DELETE FROM opcoes_produto WHERE produto_id = ? AND nome NOT IN (${marcadores})`)
    .run(produto.id, ...opcoes);
  opcoes.forEach((nome, ordem) => {
    db.prepare(`
      INSERT INTO opcoes_produto (produto_id, nome, ordem) VALUES (?, ?, ?)
      ON CONFLICT(produto_id, nome) DO UPDATE SET ordem = excluded.ordem
    `).run(produto.id, nome, ordem);
  });
}

// Cria o usuário administrador (dono da lanchonete), se ainda não existir.
// Login do painel → e-mail: admin@marcelontra.com  |  senha: admin123
const admin = db.prepare("SELECT id FROM usuarios WHERE tipo = 'admin'").get();
if (!admin) {
  db.prepare(`
    INSERT INTO usuarios (nome, email, telefone, endereco, senha_hash, tipo, email_verificado)
    VALUES (?, ?, ?, ?, ?, 'admin', 1)
  `).run('Administrador', 'admin@marcelontra.com', '(00) 0000-0000', 'Marcelontra Lanches', gerarHash('admin123'));
  console.log('Usuário administrador criado (veja o README).');
}
// O admin não precisa confirmar e-mail
db.exec("UPDATE usuarios SET email_verificado = 1 WHERE tipo = 'admin'");

module.exports = db;
