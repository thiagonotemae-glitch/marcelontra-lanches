# 🍔 Marcelontra Lanches — Delivery

Site de delivery de lanchonete feito com **Node.js** (servidor) e **SQLite** (banco de dados).
Tem cadastro e login de clientes, carrinho, pedidos com acompanhamento e um painel para a lanchonete.

## Como rodar

Precisa do **Node.js 22.13 ou mais novo** (o SQLite já vem embutido no Node, módulo `node:sqlite`).

```bash
npm install
npm start
```

Depois abra no navegador:

- Site do cliente: http://localhost:3000
- Painel da lanchonete: http://localhost:3000/admin.html

### Login do administrador (painel)

| E-mail | Senha |
|---|---|
| `admin@marcelontra.com` | `admin123` |

Clientes criam a própria conta em **Criar conta**.

Para apagar tudo (pedidos, clientes) e começar do zero: pare o servidor (Ctrl+C) e rode `npm run resetar-banco`.

## Configurar o envio de e-mail (código de confirmação)

Depois do cadastro, o site manda um **código de 6 números** para o e-mail da pessoa. A conta só é ativada depois que ela digita o código.

**Sem configurar nada**, o site funciona em **modo de teste**: o código aparece no terminal onde o `npm start` está rodando.

Para mandar e-mail de verdade (usando um Gmail):

1. Use uma conta Gmail que tenha a **verificação em duas etapas** ligada (Conta Google → Segurança).
2. Entre em https://myaccount.google.com/apppasswords e crie uma **senha de app** (nome: "Marcelontra"). O Google mostra uma senha de 16 letras.
3. Abra o arquivo `.env` na pasta do projeto e preencha:
   ```
   EMAIL_USUARIO=seuemail@gmail.com
   EMAIL_SENHA_APP=abcd efgh ijkl mnop
   ```
4. Salve e reinicie o servidor (Ctrl+C e `npm start`). O terminal vai mostrar "E-mail: códigos serão enviados de ...".

⚠️ A senha de app dá acesso ao e-mail: **não mande o arquivo `.env` para ninguém** e não coloque no GitHub (ele já está no `.gitignore`).

Regras do código: vale **10 minutos**, aceita no máximo **5 tentativas** erradas, e só dá pra pedir outro depois de **60 segundos**. No banco, o código é guardado embaralhado (hash), igual à senha.

## Estrutura dos arquivos

```
├── server.js          → servidor Node (Express), login e rotas da API
├── database.js        → cria as tabelas no SQLite, o cardápio inicial e o admin
├── auth.js            → criptografia das senhas (hash), tokens e códigos de confirmação
├── email.js           → envia o e-mail com o código (nodemailer + Gmail)
├── .env               → e-mail e senha de app do remetente (NÃO compartilhar)
├── fotos.js           → acha a foto de cada produto na pasta "imagem" pelo nome
├── imagem/            → fotos dos produtos (nome do arquivo = nome do produto; veja LEIA-ME.txt)
├── resetar-banco.js   → apaga o banco
├── lanchonete.db      → arquivo do banco SQLite (criado sozinho)
└── public/            → páginas do site (o que aparece no navegador)
    ├── index.html     → cardápio + carrinho + finalizar pedido + aba "Sobre nós" (manual da marca)
    ├── app.js         → lógica da página inicial
    ├── login.html     → entrar / criar conta
    ├── pedido.html    → meus pedidos e acompanhamento (atualiza sozinho)
    ├── perfil.html    → "Meu perfil": dados da conta, números dos pedidos e avaliação
    ├── avaliar.html   → "Avalie-nos": estrelas, comentário e média das avaliações
    ├── admin.html     → painel: pedidos, status, produtos, clientes, relatório
    ├── comum.js       → funções usadas em todas as páginas (menu, login)
    └── style.css      → visual do site (cores vermelho e amarelo)
```

## Banco de dados (tabelas e ligações)

```
categorias (1) ────< (N) produtos
cidades    (1) ────< (N) usuarios
cidades    (1) ────< (N) pedidos
usuarios   (1) ────< (N) sessoes
usuarios   (1) ────< (N) codigos_verificacao
usuarios   (1) ────< (N) pedidos
pedidos    (1) ────< (N) itens_pedido >──── (1) produtos
produtos   (1) ────< (N) opcoes_produto
usuarios   (1) ────  (1) avaliacoes
```

| Tabela | Para que serve | Ligações (chave estrangeira) |
|---|---|---|
| `categorias` | Lanches, Porções, Bebidas, Sobremesas | — |
| `produtos` | Itens do cardápio (nome, preço, emoji) | `categoria_id` → `categorias.id` |
| `cidades` | Cidades atendidas e a taxa de entrega de cada uma | — |
| `usuarios` | Contas: nome, e-mail, telefone, endereço, cidade, senha (em hash), se o e-mail foi confirmado e tipo (`cliente` ou `admin`) | `cidade_id` → `cidades.id` |
| `codigos_verificacao` | Códigos enviados por e-mail (em hash): `tipo` = `cadastro` (confirmar e-mail), `senha` (esqueci minha senha) ou `email` (trocar o e-mail no perfil, com o endereço novo em `novo_email`), validade, tentativas e se já foi confirmado | `usuario_id` → `usuarios.id` |
| `sessoes` | Quem está logado (um token por login) | `usuario_id` → `usuarios.id` |
| `pedidos` | O pedido (status, endereço, pagamento, taxa de entrega, total, data) | `usuario_id` → `usuarios.id`, `cidade_id` → `cidades.id` |

### Taxa de entrega por cidade

| Cidade | Taxa | Tempo de entrega |
|---|---|---|
| Várzea Paulista | R$ 3,00 | 30–45 min |
| Jundiaí | R$ 5,50 | 50 min–1h |
| Campo Limpo Paulista | R$ 7,00 | cerca de 1h10 |
| Jarinu | R$ 9,00 | cerca de 1h30 |

O tempo fica na coluna `tempo_entrega` da tabela `cidades`. Ele aparece no banner (o tempo da cidade do cliente, ou a tabela com todas as cidades), no carrinho e na página do pedido.

O cliente escolhe a cidade no cadastro, e pode trocar na hora de finalizar o pedido. O servidor busca a taxa na tabela `cidades` e copia o valor para o pedido. Assim, se a taxa mudar depois, os pedidos antigos continuam com o valor que foi cobrado. Para mudar as cidades ou taxas, edite a lista `CIDADES` em `database.js` e reinicie o servidor. Isso não apaga nenhum dado.
| `itens_pedido` | Quais produtos estão em cada pedido, quantos e qual opção foi escolhida | `pedido_id` → `pedidos.id`, `produto_id` → `produtos.id` |
| `opcoes_produto` | Opções de cada produto (sabor do milkshake, refrigerante, suco; água com ou sem gás) | `produto_id` → `produtos.id` |
| `avaliacoes` | Avaliação da lanchonete: nota de 1 a 5 estrelas e comentário. Cada cliente tem uma só (`UNIQUE`), e se avaliar de novo ela é atualizada (`ON CONFLICT ... DO UPDATE`) | `usuario_id` → `usuarios.id` |

A tabela `itens_pedido` liga **pedidos** e **produtos** (relação muitos-para-muitos): um pedido tem vários produtos e um produto aparece em vários pedidos.

## Como funciona o login

1. No **cadastro**, a senha passa pela função `scrypt` (módulo `crypto` do Node) e vira um **hash**. Só o hash é salvo no banco, nunca a senha de verdade.
2. No **login**, o servidor faz o hash da senha digitada e compara com o hash salvo.
3. Se bater, o servidor cria um **token** aleatório, salva na tabela `sessoes` e manda para o navegador num **cookie**.
4. Em cada requisição, o servidor lê o cookie e procura o token em `sessoes` (com `JOIN` em `usuarios`) para saber quem é.
5. Rotas de pedido exigem login; rotas do painel (`/api/admin/...`) exigem usuário do tipo `admin`.
6. Cada cliente só consegue ver os próprios pedidos.

## Rotas da API

| Método | Rota | Quem pode | O que faz |
|---|---|---|---|
| POST | `/api/cadastro` | todos | Cria uma conta (ainda não confirmada) e manda o código por e-mail |
| POST | `/api/verificar` | todos | Confere o código; se certo, confirma o e-mail e já entra |
| POST | `/api/reenviar-codigo` | todos | Manda um código novo (espera de 60 s) |
| POST | `/api/esqueci-senha` | todos | Esqueci minha senha, passo 1: confere se a conta existe e manda o código |
| POST | `/api/esqueci-senha/verificar` | todos | Passo 2: confere o código |
| POST | `/api/esqueci-senha/nova-senha` | todos | Passo 3: grava a senha nova (só depois do código certo) e desconecta os outros aparelhos |
| POST | `/api/login` | todos | Entra na conta |
| POST | `/api/logout` | todos | Sai da conta (apaga a sessão) |
| GET | `/api/eu` | todos | Diz quem está logado |
| GET | `/api/perfil` | logado | Meu perfil: dados da conta, cidade, quantos pedidos, total gasto, lanche favorito e avaliação |
| PUT | `/api/perfil` | logado | Edita nome, telefone, endereço e cidade |
| POST | `/api/perfil/email` | logado | Trocar e-mail, passo 1: confere a senha e manda um código para o e-mail **novo** |
| POST | `/api/perfil/email/reenviar` | logado | Manda outro código para o e-mail novo (espera de 60 s) |
| POST | `/api/perfil/email/confirmar` | logado | Trocar e-mail, passo 2: código certo → troca o e-mail no banco |
| DELETE | `/api/perfil/email` | logado | Desiste da troca de e-mail |
| GET | `/api/cidades` | todos | Lista as cidades atendidas e a taxa de cada uma |
| GET | `/api/categorias` | todos | Lista as categorias |
| GET | `/api/produtos` | todos | Lista os produtos do cardápio (com JOIN na categoria) |
| POST | `/api/pedidos` | logado | Cria um pedido (pedido + itens numa transação) |
| GET | `/api/meus-pedidos` | logado | Lista os pedidos do usuário |
| GET | `/api/pedidos/:id` | dono ou admin | Mostra um pedido com itens |
| GET | `/api/avaliacoes` | todos | Lista as avaliações, a média (`AVG`) e quantas de cada nota |
| POST | `/api/avaliacoes` | logado | Cria ou atualiza a avaliação do cliente |
| GET | `/api/admin/pedidos` | admin | Lista todos os pedidos |
| PATCH | `/api/admin/pedidos/:id/status` | admin | Muda o status do pedido |
| GET | `/api/admin/resumo` | admin | Relatório: pedidos, faturamento, clientes, mais vendidos |
| GET | `/api/admin/clientes` | admin | Clientes com quantidade de pedidos e total gasto |
| GET | `/api/admin/produtos` | admin | Lista todos os produtos |
| POST | `/api/admin/produtos` | admin | Cadastra um produto novo |
| PATCH | `/api/admin/produtos/:id/disponivel` | admin | Tira/coloca um produto no cardápio |

## Comandos SQL usados (para explicar na apresentação)

- `CREATE TABLE` com `PRIMARY KEY`, `FOREIGN KEY`, `CHECK`, `UNIQUE`, `DEFAULT`
- `INSERT`, `SELECT`, `UPDATE`, `DELETE` (logout apaga a sessão)
- `JOIN` e `LEFT JOIN` entre várias tabelas
- `COUNT`, `SUM`, `CASE`, `GROUP BY`, `ORDER BY`, `LIMIT` (relatórios do painel)
- `BEGIN` / `COMMIT` / `ROLLBACK` (transação ao salvar o pedido)
- `ON DELETE CASCADE` (apagar um usuário apaga as sessões dele)
