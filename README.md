# EDU+ — Carteirinha Estudantil Digital

PWA (Progressive Web App) que gera a carteirinha estudantil digital com **QR Code
dinâmico** para validação de meia-entrada. Funciona 100% offline, sem servidor e
sem dependências externas: só HTML, CSS e JavaScript puro.

## Funcionalidades

- **Carteirinha digital** com foto, nome, curso, R.A., validade e badge de
  meia-entrada, apresentada dentro de um mockup de smartphone em telas amplas e
  em tela cheia no celular.
- **QR Code gerado no dispositivo** (encoder próprio, sem CDN), com *hash de
  validade* assinado a partir de `RA | SIGLA | VALIDADE | NOME`. A instrução de
  leitura fica acima do QR e o payload não é exposto na tela.
- **QR Code que comprova a carteirinha**: o código grava um endereço
  `https://<site>/?v=<payload>` em vez de texto solto. Ao ler com a câmera de
  qualquer celular, a página abre sozinha na tela **Comprovante da
  carteirinha**, já validada — sem precisar do app instalado. O endereço vem do
  próprio app (`location`), então serve para qualquer hospedagem; para fixar um
  domínio, defina `window.EDU_BASE_URL` antes do `app.js`. Sem endereço
  (aberto por `file://`), o QR volta a gravar o payload em texto puro, que
  continua validando pela tela de validação.
- **Validação de meia-entrada**: o payload do QR é lido, o hash é conferido e a
  matrícula é consultada no JACAD (integração **simulada**, assíncrona e offline).
- **Cadastro da instituição**: apenas nome e logo; a instituição padrão é
  `Insted - Faculdade Insted`, com o wordmark vetorial empacotado em
  `assets/insted-logo.svg`. A sigla é gerada a partir do nome e usada só
  internamente no hash do QR — não aparece na interface.
- **Identidade visual pronta**: o app já abre com o aluno `Victor Sakamoto`
  (R.A. `2023156789`, curso *Análise e Desenvolvimento de Sistemas*) e o avatar
  ilustrado `assets/avatar-victor.svg`; trocar a foto remove o avatar padrão em
  definitivo.
- **Foto do estudante** pela câmera (`capture="user"`) ou pela galeria,
  recortada e redimensionada em canvas (JPEG, máx. 720 px), nos formatos 3x4 ou
  circular.
- **Offline-first**: service worker com *precache* do app shell, navegação
  *network-first* com fallback para o `index.html` em cache.
- **Instalável** como aplicativo (manifest + ícones maskable + prompt de instalação).
- **Persistência local**: IndexedDB com fallback automático para `localStorage`.

## Como usar

Abra o `index.html` no navegador (funciona direto pelo `file://`).

1. Toque na **engrenagem** no topo para editar o cadastro.
2. Preencha nome, R.A., curso e validade; adicione a foto (câmera ou galeria) e
   escolha o formato.
3. Toque em **Salvar** — o QR Code é gerado na hora.
4. Em **Validar carteirinha**, use **Usar QR desta carteirinha** para validar a
   própria carteirinha.

## Publicar no GitHub Pages

```bash
git init
git add .
git commit -m "EDU+ carteirinha estudantil digital"
git branch -M main
git remote add origin <url-do-repositorio>
git push -u origin main
```

Depois, em **Settings → Pages**, aponte para a branch `main` e a pasta `/ (root)`.
Todos os caminhos do projeto são relativos e o arquivo `.nojekyll` já está
incluído, então a página funciona em subpastas (`/EDU+/`).

> Service workers exigem `https://` ou `localhost`. Em `file://` o app
> continua funcionando, mas sem cache offline nem instalação.

## Estrutura

```
index.html            app shell com as 3 telas (carteirinha, configurações, validação)
manifest.json         manifesto da PWA
service-worker.js     precache do app shell + estratégias de cache
.nojekyll             evita processamento Jekyll no GitHub Pages
css/styles.css        identidade visual, mockup do aparelho, responsivo e impressão
js/qrcode.js          encoder de QR Code (ISO/IEC 18004) sem dependências
js/storage.js         camada de persistência (IndexedDB + localStorage)
js/jacad.js           mock do JACAD, montagem/parse do payload e hash de validade
js/app.js             estado da aplicação, render do card/QR e formulários
assets/insted-logo.svg  wordmark vetorial da instituição padrão
assets/avatar-victor.svg avatar ilustrado do aluno padrão
assets/icons/         ícones 192/512, maskable e favicon
```

## Formato do payload do QR

O QR grava o payload depois de `?v=` no endereço do app:

```
https://sakamoto060.github.io/Edu-/?v=EDU+|V2|R:2023156789|N:Victor%20Sakamoto|I:Insted%20-%20Faculdade%20Insted|S:INSTED|V:2027-09-29|C:Analise%20e%20Desenvolvimento%20de%20Sistemas|H:464B09726104B961
```

| Campo | Significado                                        |
| ----- | -------------------------------------------------- |
| `R`   | R.A. do estudante                                  |
| `N`   | nome do estudante (percent-encoded)                |
| `I`   | instituição (percent-encoded)                      |
| `S`   | sigla da instituição, usada na assinatura          |
| `V`   | validade (`AAAA-MM-DD`)                            |
| `C`   | curso (percent-encoded)                            |
| `H`   | hash de validade, 16 hex                           |

O `H` é um FNV-1a de 64 bits calculado sobre `RA|SIGLA|VALIDADE|NOME` (em
maiúsculas). Alterar qualquer um desses campos invalida a assinatura e a
carteirinha é recusada na validação. Como o hash não mudou, o payload do perfil
de exemplo continua com `464B09726104B961`.

O formato antigo (`EDU+|V1|ID:...|NOME:...|RA:...|INST:...|SIGLA:...|VAL:...|HASH:...`)
ainda é aceito na validação, então carteirinhas emitidas antes desta versão
continuam válidas.

## Integrações simuladas

| Sistema            | O que é simulado                                          |
| ------------------ | --------------------------------------------------------- |
| **JACAD**          | matrícula, curso, período, campus, situação e meia-entrada |
| **Saguah**         | transações de meia-entrada                                |
| **Hash de validade**| assinatura local do conteúdo do QR Code                   |

Os dados são derivados deterministicamente do R.A., então o mesmo RA sempre
retorna o mesmo resultado — o que permite testar a validação offline.

## Licença

Código próprio. O encoder de QR Code em `js/qrcode.js` é um port do algoritmo
de referência de Project Nayuki (MIT).
