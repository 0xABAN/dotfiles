        this.editor = this.defaultEditor;
        this.editorContainer = new Container();
        const originalEditorContainerRender = this.editorContainer.render.bind(this.editorContainer);
        this.editorContainer.render = (width) => {
            const lines = originalEditorContainerRender(width);
            const editorIsOnlyChild = this.editorContainer.children.length === 1
                && this.editorContainer.children[0] === this.editor;
            const hasAboveWidget = this.extensionWidgetsAbove.size > 0;
            // Keep whimsical and compaction loaders flush to the editor.
            if (!editorIsOnlyChild || hasAboveWidget || this.session.isCompacting) return lines;
            return ["", ...lines];
        }; // configs:editor-gap-v1
        this.editorContainer.addChild(this.editor);