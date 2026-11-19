<img src="assets/icon.svg" width="64" height="64" alt="">

# Tacada Certa

Sistema de eventos de sinuca/bilhar no modelo **six-red**, com placar ao vivo, TV, cadastros e log por partida.

## Subir o servidor

No Windows, dê dois cliques em `iniciar.bat`. Ele instala as dependências, gera a interface e sobe o servidor com watchdog.

Usuário inicial: **admin** / **admin**. No primeiro login o sistema pede para trocar a senha.

Padrão: [http://localhost:8010](http://localhost:8010). Se a porta estiver ocupada:

```bat
set PORT=8787
iniciar.bat
```

```bash
npm install
npm run build
npm start
```

O watchdog reinicia o processo se ele cair. Sem log de requisição. Reinícios vão para `data/watchdog.log`.

## Fluxo

1. Admin (ou operador) entra no painel e cadastra o **evento**.
2. No evento, cadastra **mesas** e **jogadores**.
3. Abre uma **partida** (mesa + dois jogadores, melhor de 1/3/5/7).
4. Cada partida e cada mesa ganham URL própria:

| Tela | URL |
| --- | --- |
| Controle (lançar pontos) | `/p/{id}` |
| TV | `/p/{id}/tv` |
| Log da partida | `/p/{id}/log` |
| Mesa | `/m/{id}` |
| Resultado da mesa | `/m/{id}/resultado` |
| Evento | `/e/{id}` |

O placar continua six-red: bolas 1–7 (vermelha, amarela, verde, marrom, azul, rosa, preta). O visual do controle e da TV não foi redesenhado.

TV e resultado abrem pelo link, sem login. Controle exige usuário logado.

## Papéis

- **admin** — usuários, eventos, mesas, jogadores, partidas
- **usuário comum** — eventos, mesas, jogadores, partidas e placar

## Dados

SQLite em `data/tacada-certa.db` (WAL). Estado ao vivo da partida, histórico da mesa e log de eventos (pontos, pause, frames, confronto) ficam no banco. Controle e TV sincronizam pelo servidor (SSE).
