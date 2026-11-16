"use client";
import { JournalPanel } from "../journal/JournalPanel";

/** Journal de décisions : toutes mes décisions, leur performance depuis, et leur revue. */
export function Journal() {
  return (
    <section>
      <div className="card">
        <h2>Journal de décisions</h2>
        <p className="note">
          Avant chaque décision : pourquoi, à quel prix, ce qui vous ferait changer d&apos;avis, et quand la revoir. L&apos;appli fige le contexte du moment
          (score smart money, PER, acheteurs et vendeurs) puis mesure la suite face à l&apos;ETF de référence. Le SMS de 7h47 rappelle les revues à faire.
          C&apos;est votre propre historique de réussite qui compte, pas celui des investisseurs suivis.
        </p>
        <JournalPanel />
      </div>
    </section>
  );
}
