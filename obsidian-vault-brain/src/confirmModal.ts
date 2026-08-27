import { App, Modal, Setting } from "obsidian";

/** Simple yes/no confirmation modal, used before any bulk operation that touches many files. */
export class ConfirmModal extends Modal {
	private resolvePromise: ((confirmed: boolean) => void) | null = null;

	constructor(app: App, private title: string, private message: string, private confirmLabel = "Continue") {
		super(app);
	}

	static async ask(app: App, title: string, message: string, confirmLabel?: string): Promise<boolean> {
		const modal = new ConfirmModal(app, title, message, confirmLabel);
		return new Promise((resolve) => {
			modal.resolvePromise = resolve;
			modal.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: this.title });
		contentEl.createEl("p", { text: this.message });

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Cancel")
					.onClick(() => {
						this.resolvePromise?.(false);
						this.resolvePromise = null;
						this.close();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText(this.confirmLabel)
					.setCta()
					.onClick(() => {
						this.resolvePromise?.(true);
						this.resolvePromise = null;
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.resolvePromise) {
			this.resolvePromise(false);
			this.resolvePromise = null;
		}
	}
}
