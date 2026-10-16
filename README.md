# Unified

A Solana home for projects and the depth behind them.

[![Live site](https://img.shields.io/badge/live-unified.site-informational)](https://unified.site)

- **Chain:** Solana
- **Contract address:** pending

## Overview

Unified is a static site with a live market view. It shows the ten busiest Solana pairs by day volume, taken from a public aggregator, next to a public record of what the project has and has not confirmed yet.

## Features

- Live pair board and ticker, refreshed on its own and paused while the tab is hidden
- Register-driven page: every external fact is a single record that is either stated or shown as pending
- Contract slot at the top of the page, inert until an address is stated
- Spring-based reveal motion, parallax hero, spotlight cards, scroll progress, and a full reduced-motion fallback
- No build dependencies; the deploy output is the `dist/` folder

## Links

- Site: https://unified.site
- X: pending
- GitHub: pending

## Develop

```bash
npm run build   # writes dist/
npm run gates   # runs every check, exits 0 only when all pass
npm run serve   # serves dist/ on port 4173
```

## License

MIT, see [LICENSE](LICENSE).
