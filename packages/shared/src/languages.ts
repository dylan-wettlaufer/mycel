const languagesByExtension = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
} as const;

/** The .ts extension also covers TypeScript declaration files. */
export type SourceExtension = keyof typeof languagesByExtension;
export type SourceLanguage = (typeof languagesByExtension)[SourceExtension];

export const sourceExtensions = Object.freeze(
  Object.keys(languagesByExtension) as SourceExtension[],
);

export function sourceLanguageForPath(
  path: string,
): SourceLanguage | undefined {
  const extension = sourceExtensions.find((suffix) => path.endsWith(suffix));
  return extension && languagesByExtension[extension];
}
