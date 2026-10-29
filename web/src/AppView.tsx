// The app shell's view (ADR 0011): the header, and the screen the wired App fills in.
import type { ReactNode } from "react";
import { NAV, type Screen, type View } from "./app-shell.ts";

export type AppViewProps = {
  signedIn: boolean;
  view: View;
  screen: Screen;
  onOpen: (view: View) => void;
  onSignOut: () => void;
  renderScreen: (screen: Screen) => ReactNode;
};

export function AppView({
  signedIn,
  view,
  screen,
  onOpen,
  onSignOut,
  renderScreen,
}: Readonly<AppViewProps>) {
  return (
    <main>
      <header className="screen-only">
        <h1>MiseFlow</h1>
        {signedIn && (
          <>
            <button type="button" onClick={onSignOut}>
              Sign out
            </button>
            <nav>
              {NAV.map((tab) => (
                <button
                  key={tab.view}
                  type="button"
                  aria-pressed={tab.pressedFor.includes(view)}
                  onClick={() => onOpen(tab.view)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </>
        )}
      </header>
      {renderScreen(screen)}
    </main>
  );
}
