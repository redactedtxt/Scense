// React renders MathML, but its JSX types don't list the elements. These are the few the
// About page's formula uses (DECISIONS B41).
import "react";

type MathProps = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      math: MathProps & { display?: "block" | "inline" };
      mrow: MathProps;
      mi: MathProps & { mathvariant?: "normal" };
      mn: MathProps;
      mo: MathProps & { stretchy?: "true" | "false" };
    }
  }
}
