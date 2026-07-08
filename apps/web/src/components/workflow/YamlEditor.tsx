import Editor from "@monaco-editor/react";

interface YamlEditorProps {
  value: string;
  onChange?: (value: string | undefined) => void;
  height?: string;
  readOnly?: boolean;
}

export function YamlEditor({
  value,
  onChange,
  height = "400px",
  readOnly = false,
}: YamlEditorProps) {
  return (
    <Editor
      height={height}
      defaultLanguage="yaml"
      value={value}
      onChange={onChange}
      options={{
        minimap: { enabled: false },
        tabSize: 2,
        insertSpaces: true,
        readOnly,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        folding: true,
        lineNumbers: "on",
        renderWhitespace: "selection",
        wordWrap: "on",
      }}
      theme="vs-dark"
    />
  );
}
