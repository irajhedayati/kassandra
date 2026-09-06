// @types/react 19 removed the ambient global `JSX` namespace in favor of
// `React.JSX`. Some third-party component libraries (e.g. @monaco-editor/react)
// still reference the bare global `JSX.Element` in their .d.ts files, which
// resolves to `any` without this shim; silently widening prop/callback types
// (e.g. Editor's onChange) to `any` and breaking `noImplicitAny` checks.
// https://react.dev/blog/2024/04/25/react-19-upgrade-guide#types-changes
import 'react';
import React from "react";

declare global {
  namespace JSX {
    interface Element extends React.JSX.Element {}
    interface ElementClass extends React.JSX.ElementClass {}
    interface ElementAttributesProperty extends React.JSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute extends React.JSX.ElementChildrenAttribute {}
    interface IntrinsicAttributes extends React.JSX.IntrinsicAttributes {}
    interface IntrinsicClassAttributes<T> extends React.JSX.IntrinsicClassAttributes<T> {}
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }
}
