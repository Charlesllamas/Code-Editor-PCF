import Monaco from "@monaco-editor/react";

export interface IProps {
    code: string | undefined;
    language: string;
    onChange: (code: string | undefined) => void;
}

export const Editor: React.FunctionComponent<IProps> = (props) => {

    function handleEditorChange(value: string | undefined, event: any) {
        props.onChange(value);
    }

    return <Monaco
        height="90vh"
        defaultLanguage={props.language.toLowerCase()}
        defaultValue={props.code}
        onChange={handleEditorChange}
    />;
};