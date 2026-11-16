import { NextResponse, type NextRequest } from "next/server";

/**
 * Protection par mot de passe (authentification HTTP « Basic ») quand APP_USER et APP_PASSWORD sont définis.
 * Indispensable dès que l'appli est en ligne : /admin affiche les numéros et l'historique des SMS.
 */
export function middleware(req: NextRequest) {
  const user = process.env.APP_USER, pass = process.env.APP_PASSWORD;
  if (!user || !pass) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const [u, ...rest] = atob(header.slice(6)).split(":");
    if (u === user && rest.join(":") === pass) return NextResponse.next();
  }
  return new NextResponse("Authentification requise", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Tracker investisseurs", charset="UTF-8"' } });
}

// Tout sauf le contrôle de santé (utilisé par l'hébergeur) et les fichiers statiques de Next.
export const config = { matcher: ["/((?!api/health|_next/static|_next/image|favicon.ico).*)"] };
