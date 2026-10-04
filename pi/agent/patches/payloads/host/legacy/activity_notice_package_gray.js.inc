    showPackageUpdateNotification(packages) {
        const action = theme.fg("accent", `${APP_NAME} update --extensions`);
        const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;
        const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(new Text(`${theme.bold(theme.fg("toolOutput", "Package Updates Available"))}\n${updateInstruction}\n${theme.fg("muted", "Packages:")}\n${packageLines}`, 1, 0, (text) => theme.bg("userMessageBg", text)));
        this.ui.requestRender();
    }