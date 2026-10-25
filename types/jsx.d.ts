// React 19's types dropped the global JSX namespace; the app's components
// still annotate `JSX.Element`, so point it at React's.
import type { JSX as ReactJSX } from "react";

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
  }
}
