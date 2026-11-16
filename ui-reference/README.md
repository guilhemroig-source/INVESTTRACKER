# Référence UI du prototype

- `style-terminal.css` : la feuille de style complète du look « terminal de trading » (variables `--cds-*` = tokens du dashboard d'origine : gap-xs/sm/md/lg ≈ 4/8/16/24 px, pad idem, font-size caption ≈ .8rem, body 1rem ; `--font-anthropic-sans` → Inter ou système, `--font-anthropic-serif` → une serif type Source Serif).
- `layout-sections.html` : la structure HTML des onglets Alertes / Super-investisseurs / ARK / Initiés & Musk (les attributs `data-draw`/`data-source` sont propres au prototype : les remplacer par du rendu React).
- Onglets Trump et Congrès : tuiles (transactions, achats, ventes, % déclarées hors délai 45 j), graphique en barres empilées par déclaration, top 15 actions, table des 150 dernières opérations avec recherche et filtre ; tuiles élus/transactions/achats/ventes, table des élus les plus actifs, table des dernières transactions avec colonne Perf.
