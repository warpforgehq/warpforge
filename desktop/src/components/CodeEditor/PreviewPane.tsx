import { Markdown } from "../Markdown";
import type { FileDoc } from "../../protocol";
import { getMimeType } from "./mime";

export function BinaryPreview({ doc }: { doc: FileDoc }) {
  return (
    <div className="flex h-full flex-col items-center justify-center overflow-auto bg-card p-4">
      {doc.newDataBase64 ? (
        <>
          <img
            src={`data:${getMimeType(doc.path)};base64,${doc.newDataBase64}`}
            alt={doc.path}
            className="max-h-full max-w-full object-contain"
          />
          <div className="mt-2 text-xs text-muted-foreground">
            {doc.path} • {((doc.newDataBase64.length * 0.75) / 1024).toFixed(1)} KB
          </div>
        </>
      ) : (
        <div className="text-sm text-muted-foreground">No image data available for {doc.path}</div>
      )}
    </div>
  );
}

export function PreviewPane({
  doc,
  htmlDoc,
  svgImage,
  previewText,
}: {
  doc: FileDoc;
  htmlDoc: boolean;
  svgImage: boolean;
  previewText: string;
}) {
  return (
    <div className="h-full overflow-auto px-4 py-3">
      {htmlDoc ? (
        /* `allow-scripts` so an HTML prototype actually runs — a
           script-driven page previewed without it looks broken
           rather than unfinished. It stays safe because the frame
           keeps its opaque origin: never add `allow-same-origin`
           alongside it, since the pair lets the framed file reach
           this app's DOM and storage and voids the sandbox. Every
           other capability (forms, popups, top navigation) stays
           denied. */
        <iframe
          title={doc.path}
          srcDoc={previewText}
          sandbox="allow-scripts"
          className="h-full w-full border-0 bg-white"
        />
      ) : svgImage ? (
        <div className="flex h-full items-center justify-center">
          {doc.newDataBase64 ? (
            <img
              src={`data:image/svg+xml;base64,${doc.newDataBase64}`}
              alt={doc.path}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div
              className="typeset typeset-docs max-w-none"
              dangerouslySetInnerHTML={{ __html: previewText }}
            />
          )}
        </div>
      ) : (
        <Markdown>{previewText}</Markdown>
      )}
    </div>
  );
}
