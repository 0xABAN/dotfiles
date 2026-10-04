    renderWidgetContainer(container, widgets, spacerWhenEmpty, leadingSpacer) {
        container.clear();
        if (widgets.size === 0) {
            if (spacerWhenEmpty && !this.session.isCompacting) { // configs:editor-gap-v2
                container.addChild(new CompactWidgetSpacer(this.ui));
            }
            return;
        }
        if (leadingSpacer) {
            container.addChild(new CompactWidgetSpacer(this.ui));
        }
        for (const component of widgets.values()) {
            container.addChild(component);
        }
    }