import ts from "typescript";
import type { BehaviourCallAdapter } from "./adapters.js";

export const extractFetch: BehaviourCallAdapter = (call, adapter) => {
  const { context, owner, ownerId, records, graph } = adapter;
  if (
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== "fetch" ||
    context.checker
      .getSymbolAtLocation(call.expression)
      ?.declarations?.some((declaration) =>
        context.sourceFiles.has(declaration.getSourceFile().fileName),
      )
  )
    return false;
  const evidence = context.evidence(call, owner.anchor);
  const attributes: Record<string, string> = {
    traceRole: "http_request",
    client: "fetch",
    binding: "unresolved",
  };
  const request = adapter.step("fetch-request", "fetch", call, attributes);
  records.relationship(
    "CALLS",
    ownerId,
    request,
    evidence,
    "native-fetch-call",
  );
  const url = call.arguments[0];
  const options = call.arguments[1];
  if (
    call.questionDotToken ||
    call.arguments.length > 2 ||
    !url ||
    (!ts.isStringLiteral(url) && !ts.isNoSubstitutionTemplateLiteral(url))
  ) {
    adapter.boundary(
      request,
      call,
      "dynamic-url",
      "Only literal root-relative fetch URLs are resolved; dynamic values and wrappers are not propagated.",
    );
    return true;
  }
  if (
    !url.text.startsWith("/") ||
    url.text.startsWith("//") ||
    /[\\\r\n]/.test(url.text)
  ) {
    adapter.boundary(
      request,
      call,
      "external-or-relative-url",
      "Only root-relative requests within the same application package are resolved.",
    );
    return true;
  }
  attributes.url = url.text;
  let method = "GET";
  if (options) {
    if (
      !ts.isObjectLiteralExpression(options) ||
      options.properties.some(
        (property) =>
          !ts.isPropertyAssignment(property) ||
          ts.isComputedPropertyName(property.name),
      )
    ) {
      adapter.boundary(
        request,
        call,
        "dynamic-http-options",
        "Fetch options must be a direct object without spreads, computed properties, or shorthand bindings.",
      );
      return true;
    }
    const methods = options.properties.filter(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText().replace(/^['"]|['"]$/g, "") === "method",
    );
    if (
      methods.length > 1 ||
      (methods.length === 1 &&
        (!ts.isPropertyAssignment(methods[0]!) ||
          !ts.isStringLiteral(methods[0]!.initializer)))
    ) {
      adapter.boundary(
        request,
        call,
        "dynamic-http-method",
        "The HTTP method must be an unambiguous literal.",
      );
      return true;
    }
    if (
      methods[0] &&
      ts.isPropertyAssignment(methods[0]) &&
      ts.isStringLiteral(methods[0].initializer)
    )
      method = methods[0].initializer.text.toUpperCase();
  }
  // Reject normalization tricks rather than changing the source URL's meaning.
  const pathname = url.text.split(/[?#]/)[0]!;
  attributes.method = method;
  attributes.pathname = pathname;
  if (
    pathname.split("/").some((segment) => [".", ".."].includes(segment)) ||
    /%/.test(pathname)
  ) {
    adapter.boundary(
      request,
      call,
      "unsupported-url-path",
      "Encoded or dot-segment URL paths are not normalized for endpoint matching.",
    );
    return true;
  }
  const scope = context.resolution?.packageRoot?.(owner.source.fileName);
  const matches = graph.entities.filter(
    (entity) =>
      entity.kind === "endpoint" &&
      entity.attributes.method === method &&
      entity.sources.some(
        (source) =>
          scope !== undefined &&
          context.resolution?.packageRoot?.(source.path) === scope,
      ) &&
      entity.attributes.pattern === pathname,
  );
  if (matches.length !== 1) {
    adapter.boundary(
      request,
      call,
      matches.length ? "ambiguous-endpoint" : "unresolved-endpoint",
      "No unique same-package Next.js handler matches the literal method and path; dynamic routes are not expanded.",
    );
    return true;
  }
  attributes.binding = "resolved";
  records.relationship(
    "CALLS",
    request,
    matches[0]!.id,
    evidence,
    "literal-http-endpoint",
  );
  return true;
};
