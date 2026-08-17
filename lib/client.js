// dsh-mmx-bridge — 客户端增强（随插件自带，无需手动合并）
// 经 window.__ModuleLoader__.load 注册：
//   1. MmxToolView —— mmx_bridge 工具调用卡片：音频/视频内嵌播放器 + 图片缩略图 + 下载图标
//      （tool.call.toolview keyed slot，替换默认工具卡片）
//   2. installInlinePlayers —— 消息正文里 /mmx-files/* 媒体链接自动增强为播放器卡片
// 随包自动加载（package.json 声明 dsh.client），安装插件后刷新页面即生效。
window.__ModuleLoader__.load({
	id: "dsh-mmx-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let react = require("react");

		// 媒体加载失败容错：显示错误提示而不是黑屏/裂图。
		function mediaFailHint(el, name) {
			try {
				if (!el || !el.parentElement) return;
				const hint = document.createElement("div");
				hint.style.cssText = "font-size:12px;color:var(--dsw-alias-label-error);padding:6px 0;display:flex;align-items:center;gap:6px;width:100%";
				hint.textContent = "⚠️ 无法加载 " + name + "（文件可能不存在或已被清理）";
				el.style.display = "none";
				el.parentElement.insertBefore(hint, el);
			} catch (e) {}
		}

// mmx_bridge 自定义工具视图：图片缩略图 + 音频/视频内嵌播放器（在当前页面直接播放）
		function MmxToolView(props) {
			const block = props && props.block;
			const done = block !== null && typeof block === "object" && "kind" in block;
			const content = done && Array.isArray(block.content) ? block.content : null;
			let text = "";
			if (content) {
				for (const b of content) {
					if (b && b.type === "text" && typeof b.text === "string") text += b.text;
					else if (b) text += JSON.stringify(b, null, 2);
				}
			} else if (block && block.error) {
				text = String(block.error.name || "") + ": " + String(block.error.code || "");
			}
			let parsed = null;
			try {
				const trimmed = text.trim();
				if (trimmed.startsWith("{")) parsed = JSON.parse(trimmed);
			} catch (e) {
				parsed = null;
			}
			// 收集产物条目 { name, url }：优先使用工具结果里的 url/urls（v10+），
			// 否则由 /tmp/mmx-out/<name> 推导 /mmx-files/<name>。
			const items = [];
			const seen = new Set();
			const pushItem = (p, url) => {
				if (typeof p !== "string" || !p || seen.has(p)) return;
				seen.add(p);
				const name = p.split("/").pop();
				const u = typeof url === "string" && url ? url : "/mmx-files/" + encodeURIComponent(name);
				items.push({ name, url: u });
			};
			if (parsed && Array.isArray(parsed.files)) {
				const urls = parsed && Array.isArray(parsed.urls) ? parsed.urls : [];
				for (let k = 0; k < parsed.files.length; k++) pushItem(parsed.files[k], urls[k]);
			}
			if (parsed && typeof parsed.file === "string") pushItem(parsed.file, parsed.url);
			const re = /\/tmp\/mmx-out\/[A-Za-z0-9._-]+/g;
			let m;
			while ((m = re.exec(text)) !== null) pushItem(m[0], null);
			const isImage = (n) => /\.(jpe?g|png|webp|gif)$/i.test(n);
			const isAudio = (n) => /\.(mp3|wav|flac|ogg|m4a)$/i.test(n);
			const isVideo = (n) => /\.(mp4|webm|mov)$/i.test(n);
			const isImageAction = parsed !== null && parsed && parsed.action === "image";
			return react.createElement("div", { style: { padding: "4px 2px" } },
				items.length > 0
					? react.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 6 } },
						items.map((it, i) => {
							const name = it.name;
							const url = it.url;
							const downloadLink = react.createElement("a", {
								href: url,
								download: name,
								title: "下载 " + name,
								"aria-label": "下载 " + name,
								style: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 6, background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-primary)", textDecoration: "none", cursor: "pointer", flex: "none" }
							},
								react.createElement("svg", {
									width: 13,
									height: 13,
									viewBox: "0 0 24 24",
									fill: "none",
									stroke: "currentColor",
									strokeWidth: 2,
									strokeLinecap: "round",
									strokeLinejoin: "round"
								},
									react.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }),
									react.createElement("polyline", { points: "7 10 12 15 17 10" }),
									react.createElement("line", { x1: 12, y1: 15, x2: 12, y2: 3 })
								)
							);
							if (isImage(name)) {
								return react.createElement("div", { key: i, style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, maxWidth: 160 } },
									react.createElement("img", {
										src: url,
										alt: name,
										onError: (e) => mediaFailHint(e.target, name),
										style: { maxWidth: 150, maxHeight: 150, borderRadius: 8, border: "1px solid var(--dsw-alias-border-l1)", display: "block" }
									}),
									react.createElement("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, name),
									downloadLink
								);
							}
							if (isAudio(name)) {
								return react.createElement("div", { key: i, style: { display: "flex", flexDirection: "column", gap: 8, width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)" } },
									react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
										react.createElement("span", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "🎵 " + name),
										downloadLink
									),
									react.createElement("audio", { controls: true, preload: "metadata", src: url, onError: (e) => mediaFailHint(e.target, name), style: { width: "100%", height: 38, display: "block" } })
								);
							}
							if (isVideo(name)) {
								return react.createElement("div", { key: i, style: { display: "flex", flexDirection: "column", gap: 6, width: "100%" } },
									react.createElement("video", { controls: true, preload: "metadata", src: url, onError: (e) => mediaFailHint(e.target, name), style: { maxWidth: "100%", maxHeight: 320, borderRadius: 8, border: "1px solid var(--dsw-alias-border-l1)", display: "block" } }),
									react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
										react.createElement("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, name),
										downloadLink
									)
								);
							}
							return react.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2)" } },
								react.createElement("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, name),
								downloadLink
							);
						})
					)
					: null,
				items.length === 0 && text
					? react.createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" } }, text)
					: null,
				items.length > 0 && isImageAction
					? react.createElement("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)", marginTop: 2 } },
						"已生成 " + items.length + " 张图片，保存在 /tmp/mmx-out/（点击「下载」保存到本地）")
					: null
			);
		}

				// ── 正文媒体链接 → 内嵌播放器/图片预览 ────────────────────────────────────
		// 把消息正文里指向 /mmx-files/* 的音频/视频/图片链接自动增强为内嵌卡片
		// （图片显示预览，音频/视频显示播放器；链接保留并转为「下载」）。
		// 幂等：已处理的链接标记 data-mmx-inline="done"；
		// 工具卡片（tool.call.toolview）内的链接已有播放器，跳过。
		function installInlinePlayers() {
			if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
			const MEDIA_RE = /\.(mp3|wav|flac|ogg|m4a|mp4|webm|mov|jpe?g|png|webp|gif)(\?.*)?$/i;
			const AUDIO_RE = /\.(mp3|wav|flac|ogg|m4a)(\?.*)?$/i;
			const IMAGE_RE = /\.(jpe?g|png|webp|gif)(\?.*)?$/i;
			let timer = null;
			const scan = () => {
				if (timer) return;
				timer = setTimeout(() => {
					timer = null;
					try {
						const links = document.querySelectorAll('a[href*="/mmx-files/"]');
						for (const a of links) {
							if (a.dataset.mmxInline === "done") continue;
							const href = a.href || "";
							if (!MEDIA_RE.test(href)) continue;
							a.dataset.mmxInline = "done";
							if (a.closest('[data-slot="tool.call.toolview"]') || a.closest("audio, video, img")) continue;
							const isAudio = AUDIO_RE.test(href);
							const isImage = IMAGE_RE.test(href);
							const name = decodeURIComponent(href.split("/").pop().split("?")[0]);
							const anchor = a.parentElement;
							const wrap = document.createElement("div");
							wrap.style.cssText = "margin:6px 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3);display:flex;flex-direction:column;gap:8px;max-width:480px";
							const label = document.createElement("div");
							label.style.cssText = "font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:8px";
							const labelText = document.createElement("span");
							labelText.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
							labelText.textContent = (isImage ? "🖼️ " : isAudio ? "🎵 " : "🎬 ") + name;
							label.appendChild(labelText);
							const media = document.createElement(isImage ? "img" : (isAudio ? "audio" : "video"));
							if (isImage) {
								media.alt = name;
								media.style.cssText = "width:100%;max-height:320px;border-radius:8px;display:block;object-fit:contain;background:var(--dsw-alias-bg-module-platform)";
							} else {
								media.controls = true;
								media.preload = "metadata";
								media.style.cssText = "width:100%;display:block" + (isAudio ? ";height:38px" : ";max-height:320px;border-radius:8px");
							}
							media.src = href;
							media.onerror = () => mediaFailHint(media, name);
							// 原链接改成图标下载按钮（与工具卡片同款）：先保留在原位置，
							// wrap 插入原位后再把按钮移入文件名行。
							a.textContent = "";
							a.removeAttribute("download");
							a.setAttribute("download", "");
							a.setAttribute("aria-label", "下载 " + name);
							a.setAttribute("title", "下载 " + name);
							a.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
							a.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);text-decoration:none;cursor:pointer;flex:none";
							wrap.appendChild(label);
							wrap.appendChild(media);
							if (anchor) anchor.insertBefore(wrap, a);
							label.appendChild(a);
						}
					} catch (e) { /* 单个链接增强失败不中断其余处理 */ }
				}, 150);
			};
			const mo = new MutationObserver(scan);
			mo.observe(document.body, { childList: true, subtree: true });
			scan();
			return () => mo.disconnect();
		}

		// ── 内置管理面板（设置 → 插件 → 插件配置）───────────────────────────────
		// 与服务端路由 /api/mmx-bridge/status、/api/mmx-bridge/set-enabled、
		// /api/dsh-plugins/set-config 配套。卡片样式与 dsh-plugin-manager 一致。
		const css = [
			".dpm_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
			".dpm_card:hover{border-color:var(--dsw-alias-label-dimmed)}",
			".dpm_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
			".dpm_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
			".dpm_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
			".dpm_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
			".dpm_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
			".dpm_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
			".dpm_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
			".dpm_chevronOpen{transform:rotate(180deg)}",
			".dpm_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}",
			".dpm_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
			".dpm_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}",
			".dpm_discard,.dpm_save{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
			".dpm_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}",
			".dpm_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
			".dpm_discard:disabled,.dpm_save:disabled{opacity:.4;cursor:default}",
			".dpm_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}",
			".dpm_field+.dpm_field{border-top:1px solid var(--dsw-alias-border-l2)}",
			".dpm_head{align-items:center;gap:8px;display:flex}",
			".dpm_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}",
			".dpm_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
			".dpm_badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}",
			".dpm_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
			".dpm_controlRow{align-items:center;gap:8px;display:flex}",
			".dpm_action{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
			".dpm_action:disabled{opacity:.4;cursor:default}",
			".dpm_actionPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
			".dpm_actionGhost{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}",
			".dpm_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}",
			".dpm_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}"
		].join("");
		const cssTagId = "dsh-mmx-bridge/plugin-card.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(cssTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-mmx-bridge";
			tag.dataset.pluginCss = cssTagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		function useMmxStatus() {
			const [data, setData] = react.useState(null);
			const [error, setError] = react.useState(null);
			const refresh = react.useCallback(async () => {
				try {
					const res = await fetch("/api/mmx-bridge/status");
					const json = await res.json();
					setData(json);
					setError(null);
				} catch (e) {
					setError(String(e && e.message ? e.message : e));
				}
			}, []);
			react.useEffect(() => {
				refresh();
				const id = setInterval(refresh, 5000);
				return () => clearInterval(id);
			}, [refresh]);
			return { data, error, refresh };
		}

		async function postJson(url, body) {
			const res = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const parsed = await res.json().catch(() => null);
				throw new Error(parsed && parsed.error ? parsed.error : "HTTP " + res.status);
			}
			return res.json();
		}

		function MmxSettingsCard() {
			const { data, error, refresh } = useMmxStatus();
			const [open, setOpen] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [failed, setFailed] = react.useState(null);
			const [draft, setDraft] = react.useState(null);
			const [countSaved, setCountSaved] = react.useState(false);

			const ctrl = data && data.visionControl ? data.visionControl : null;
			const visEnabled = ctrl && typeof ctrl.enabled === "boolean" ? ctrl.enabled : true;
			const visCount = ctrl && typeof ctrl.count === "number" ? ctrl.count : 3;
			const webSearchEnabled = ctrl ? ctrl.webSearchEnabled === true : false;
			const readImageEnabled = ctrl ? ctrl.readImageEnabled === true : false;
			const status = data && data.vision ? data.vision : null;

			const draftText = draft !== null ? draft : String(visCount);
			const draftNum = Number(draftText);
			const countDirty = draft !== null && draftText !== String(visCount);
			const countInvalid = draft !== null && (!/^\d+$/.test(draftText.trim()) || draftNum < 1 || draftNum > 8);

			const toggle = async (plugin, enabled) => {
				setBusy(true);
				setFailed(null);
				try {
					await postJson("/api/mmx-bridge/set-enabled", { plugin, enabled });
					await refresh();
				} catch (e) {
					setFailed(String(e && e.message ? e.message : e));
				} finally {
					setBusy(false);
				}
			};

			const saveCount = async () => {
				if (countInvalid) return;
				setBusy(true);
				setFailed(null);
				try {
					await postJson("/api/dsh-plugins/set-config", { count: Math.min(8, Math.max(1, Math.round(draftNum))) });
					setDraft(null);
					setCountSaved(true);
					await refresh();
					setTimeout(() => setCountSaved(false), 2000);
				} catch (e) {
					setFailed(String(e && e.message ? e.message : e));
				} finally {
					setBusy(false);
				}
			};

			const card = react.createElement("li", { className: "dpm_card" + (open ? " dpm_cardOpen" : "") },
				react.createElement("button", { type: "button", className: "dpm_header", "aria-expanded": open, onClick: () => setOpen(!open) },
					react.createElement("span", { className: "dpm_headText" },
						react.createElement("span", { className: "dpm_name" }, "dsh-mmx-bridge"),
						react.createElement("span", { className: "dpm_description" },
							"MiniMax 多模态（图片 / 视频 / 语音 / 音乐 / 联网搜索）" + (status ? " · 已调用 " + (status.calls || 0) + " 次" : ""))
					),
					visEnabled ? react.createElement("span", { className: "dpm_badge" }, "已启用") : react.createElement("span", { className: "dpm_badge dpm_badgeMuted" }, "已停用"),
					react.createElement("span", { className: "dpm_chevron" + (open ? " dpm_chevronOpen" : "") }, "▼")
				),
				open ? react.createElement("div", { className: "dpm_body" },
					error ? react.createElement("p", { className: "dpm_failed", role: "status" }, "错误：" + error) : null,
					react.createElement("div", { className: "dpm_field" },
						react.createElement("div", { className: "dpm_head" },
							react.createElement("label", { className: "dpm_label", htmlFor: "mmxb-enabled" }, "启用 dsh-mmx-bridge"),
							react.createElement("span", { className: visEnabled ? "dpm_badge" : "dpm_badge dpm_badgeMuted" }, visEnabled ? "已启用" : "已停用")
						),
						react.createElement("div", { className: "dpm_controlRow" },
							react.createElement("button", {
								type: "button",
								className: "dpm_action " + (visEnabled ? "dpm_actionPrimary" : "dpm_actionGhost"),
								disabled: busy,
								onClick: () => toggle("vision", !visEnabled)
							}, visEnabled ? "停用" : "启用")
						),
						react.createElement("p", { className: "dpm_hint" }, "关闭后 mmx_bridge 工具拒绝调用。")
					),
					react.createElement("div", { className: "dpm_field" },
						react.createElement("div", { className: "dpm_head" },
							react.createElement("label", { className: "dpm_label", htmlFor: "mmxb-count" }, "每次生成图片数量"),
							countSaved ? react.createElement("span", { className: "dpm_badge" }, "已保存") : null
						),
						react.createElement("div", { className: "dpm_controlRow" },
							react.createElement("input", {
								id: "mmxb-count",
								className: "dpm_input",
								type: "text",
								inputMode: "numeric",
								"aria-invalid": countInvalid ? true : undefined,
								value: draftText,
								disabled: busy,
								onChange: (e) => setDraft(e.target.value)
							}),
							react.createElement("button", {
								type: "button",
								className: "dpm_action dpm_actionGhost",
								disabled: !countDirty || countInvalid || busy,
								onClick: saveCount
							}, "保存")
						),
						countInvalid
							? react.createElement("p", { className: "dpm_failed", role: "status" }, "请输入 1–8 之间的整数。")
							: react.createElement("p", { className: "dpm_hint" }, "调用 mmx_bridge（action=image）一次生成的图片张数（1–8，默认 3）。")
					),
					react.createElement("div", { className: "dpm_field" },
						react.createElement("div", { className: "dpm_head" },
							react.createElement("label", { className: "dpm_label", htmlFor: "mmxb-websearch" }, "web_search 使用 mmx-cli"),
							react.createElement("span", { className: webSearchEnabled ? "dpm_badge" : "dpm_badge dpm_badgeMuted" }, webSearchEnabled ? "已启用" : "已关闭")
						),
						react.createElement("div", { className: "dpm_controlRow" },
							react.createElement("button", {
								type: "button",
								className: "dpm_action " + (webSearchEnabled ? "dpm_actionPrimary" : "dpm_actionGhost"),
								disabled: busy,
								onClick: () => toggle("websearch", !webSearchEnabled)
							}, webSearchEnabled ? "停用 mmx" : "启用 mmx")
						),
						react.createElement("p", { className: "dpm_hint" }, "默认关闭（使用 DeepSeek 内置搜索）。开启后每个会话的 web_search 改用 mmx-cli，约 2 秒内生效，无需重启。")
					),
					react.createElement("div", { className: "dpm_field" },
						react.createElement("div", { className: "dpm_head" },
							react.createElement("label", { className: "dpm_label", htmlFor: "mmxb-readimage" }, "read_image 使用 mmx-cli"),
							react.createElement("span", { className: readImageEnabled ? "dpm_badge" : "dpm_badge dpm_badgeMuted" }, readImageEnabled ? "已启用" : "已关闭")
						),
						react.createElement("div", { className: "dpm_controlRow" },
							react.createElement("button", {
								type: "button",
								className: "dpm_action " + (readImageEnabled ? "dpm_actionPrimary" : "dpm_actionGhost"),
								disabled: busy,
								onClick: () => toggle("readimage", !readImageEnabled)
							}, readImageEnabled ? "停用 mmx" : "启用 mmx")
						),
						react.createElement("p", { className: "dpm_hint" }, "默认关闭（read_image 返回图片块）。开启后改走 MiniMax VLM 返回文字描述，约 2 秒内生效，无需重启。")
					),
					failed ? react.createElement("p", { className: "dpm_failed", role: "status" }, "错误：" + failed) : null
				) : null
			);
			return card;
		}

		function apply(ctx) {
			installInlinePlayers();
			ctx.inject(["slots"], (scope) => {
				scope.slots.inject("tool.call.toolview", () =>
					scope.slots.register(
						{ name: "tool.call.toolview", key: "mmx_bridge" },
						MmxToolView
					)
				);
				// 设置页卡片：DSH rc.7+ 把 settings.plugin.item 槽改为 keyed 分发，按 settings
				// 命名空间（settings.describe() 返回）匹配卡片 —— 因此同时声明 id（rc.6 list 槽）
				// 与 key（rc.7 keyed 槽，值等于服务端注册的命名空间 dsh-mmx-bridge），两代兼容。
				scope.slots.inject("settings.plugin.item", () =>
					scope.slots.register(
						{ name: "settings.plugin.item", id: "dsh-mmx-bridge", key: "dsh-mmx-bridge", order: 30 },
						() => react.createElement(MmxSettingsCard, null)
					)
				);
			});
		}

		exports.apply = apply;
		return module.exports;
	}
});
