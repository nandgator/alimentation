import { Component, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Unavailable } from "./Unavailable.tsx";

type Props = { children: ReactNode; where: string; home: string };
type State = { failed: string | null };

/**
 * One screen that breaks must not take the kitchen with it: the sidebar and the bar stay, and the page says what
 * happened with a way to try again. It clears itself when the person goes to another screen.
 */
class Boundary extends Component<Props, State> {
  override state: State = { failed: null };

  static getDerivedStateFromError(): State {
    return { failed: "failed" };
  }

  override componentDidUpdate(prev: Props) {
    if (prev.where !== this.props.where && this.state.failed) this.setState({ failed: null });
  }

  override componentDidCatch(error: unknown) {
    console.error("A screen failed to draw:", error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Unavailable
        title="This screen could not be shown"
        reason="Something went wrong drawing it. Nothing you did has been lost. Try again, or go back to your home."
        home={this.props.home}
        homeLabel="Go to your home"
        showKitchens={false}
        onRetry={() => this.setState({ failed: null })}
      />
    );
  }
}

/** Wraps the page region of a kitchen. */
export function PageBoundary({ children, home }: { children: ReactNode; home: string }) {
  const [where] = useLocation();
  return (
    <Boundary where={where} home={home}>
      {children}
    </Boundary>
  );
}
