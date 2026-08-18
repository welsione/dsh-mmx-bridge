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
		// /api/dsh-plugins/set-config 配套。样式跟随 DSH 宿主设计系统
		// （--dsw-alias-* 令牌），分区 + 开关控件，克制的排版。
		const css = [
			".mmxb_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
			".mmxb_card:hover{border-color:var(--dsw-alias-label-dimmed)}",
			".mmxb_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
			".mmxb_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
			".mmxb_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
			".mmxb_headText{flex-direction:column;flex:1;gap:3px;min-width:0;display:flex}",
			".mmxb_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
			".mmxb_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}",
			".mmxb_pill{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 10px;font-size:11px;font-weight:500;line-height:18px;flex:none}",
			".mmxb_pillOn{background:var(--dsw-alias-brand-primary);color:#fff}",
			".mmxb_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .18s ease}",
			".mmxb_chevronOpen{transform:rotate(180deg)}",
			".mmxb_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:4px 0 12px}",
			".mmxb_section{padding:12px 0}",
			".mmxb_section+.mmxb_section{border-top:1px solid var(--dsw-alias-border-l2)}",
			".mmxb_sectionTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;letter-spacing:.02em;margin:0 0 10px;line-height:1.4}",
			".mmxb_row{display:flex;align-items:center;gap:12px;justify-content:space-between}",
			".mmxb_row+.mmxb_row{margin-top:10px}",
			".mmxb_rowText{flex-direction:column;gap:2px;min-width:0;display:flex}",
			".mmxb_rowLabel{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}",
			".mmxb_rowHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.55}",
			".mmxb_switch{appearance:none;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);width:38px;height:22px;border-radius:999px;flex:none;cursor:pointer;position:relative;transition:background .18s,border-color .18s;padding:0}",
			".mmxb_switch::after{content:\"\";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .18s,background .18s}",
			".mmxb_switchOn{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}",
			".mmxb_switchOn::after{transform:translateX(16px);background:#fff}",
			".mmxb_switch:disabled{opacity:.45;cursor:default}",
			".mmxb_switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}",
			".mmxb_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:32px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:13px;line-height:1.5;width:64px}",
			".mmxb_input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}",
			".mmxb_action{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 12px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);background:0 0}",
			".mmxb_action:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".mmxb_actionPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-label-primary)}",
			".mmxb_action:disabled{opacity:.4;cursor:default}",
			".mmxb_panel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:10px 12px;margin-top:10px;display:flex;flex-direction:column;gap:6px}",
			".mmxb_panelRow{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5;min-width:0}",
			".mmxb_panelKey{color:var(--dsw-alias-label-tertiary);flex:none}",
			".mmxb_panelVal{color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".mmxb_example{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 8px;word-break:break-all;white-space:pre-wrap;line-height:1.5;margin:0}",
			".mmxb_status{margin:10px 0 0;font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5}",
			".mmxb_failed{color:var(--dsw-alias-label-error);font-size:12px;line-height:1.5;margin:8px 0 0}",
			".mmxb_saved{color:var(--dsw-alias-label-secondary);font-size:12px;flex:none}"
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

		function MmxSwitch(props) {
			return react.createElement("button", {
				type: "button",
				role: "switch",
				"aria-checked": props.on ? true : false,
				"aria-label": props.label || "",
				className: "mmxb_switch" + (props.on ? " mmxb_switchOn" : ""),
				disabled: props.disabled || false,
				onClick: () => { if (props.onToggle) props.onToggle(!props.on); }
			});
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
			const webSearchEnabled = ctrl ? ctrl.webSearchEnabled !== false : true;
			const readImageEnabled = ctrl ? ctrl.readImageEnabled !== false : true;
			const imageBridgeEnabled = ctrl ? ctrl.imageBridgeEnabled !== false : true;
			const status = data && data.vision ? data.vision : null;
			const bridgeImages = status && typeof status.bridgeImages === "number" ? status.bridgeImages : 0;
			const outDir = status && typeof status.outDir === "string" && status.outDir ? status.outDir : "/tmp/mmx-out";
			const mmxPath = status && typeof status.mmx === "string" ? status.mmx : "";
			const calls = status && typeof status.calls === "number" ? status.calls : 0;
			const failures = status && typeof status.failures === "number" ? status.failures : 0;

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

			const origin = typeof window !== "undefined" && window.location && window.location.origin ? window.location.origin : "http://<host>:<port>";
			const statusLine = [mmxPath ? "mmx: " + mmxPath : "", "调用 " + calls + " 次", "失败 " + failures + " 次", "桥接 " + bridgeImages + " 张"].filter(Boolean).join(" · ");

			const card = react.createElement("li", { className: "mmxb_card" + (open ? " mmxb_cardOpen" : "") },
				react.createElement("button", { type: "button", className: "mmxb_header", "aria-expanded": open ? true : false, onClick: () => setOpen(!open) },
					react.createElement("span", { className: "mmxb_headText" },
						react.createElement("span", { className: "mmxb_name" }, "dsh-mmx-bridge"),
						react.createElement("span", { className: "mmxb_desc" }, "MiniMax 多模态 · 图片 / 视频 / 语音 / 音乐 / 搜索 / 配额")
					),
					react.createElement("span", { className: "mmxb_pill" + (visEnabled ? " mmxb_pillOn" : "") }, visEnabled ? "已启用" : "已停用"),
					react.createElement("svg", { className: "mmxb_chevron" + (open ? " mmxb_chevronOpen" : ""), width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
						react.createElement("polyline", { points: "4 6 8 10 12 6" })
					)
				),
				open ? react.createElement("div", { className: "mmxb_body" },
					react.createElement("div", { className: "mmxb_section" },
						react.createElement("h4", { className: "mmxb_sectionTitle" }, "图片桥（文本模型直接收图）"),
						react.createElement("div", { className: "mmxb_row" },
							react.createElement("span", { className: "mmxb_rowText" },
								react.createElement("span", { className: "mmxb_rowLabel", id: "mmxb-imagebridge" }, "拖入图片直接发送"),
								react.createElement("span", { className: "mmxb_rowHint" }, "消息（图片＋提示词）原样显示；发给 LLM 前自动落盘并替换为地址文本，Agent 自动调用 read_image 看图。支持图片的模型直通。")
							),
							react.createElement(MmxSwitch, { on: imageBridgeEnabled, disabled: busy, label: "图片桥", onToggle: (v) => toggle("imagebridge", v) })
						),
						react.createElement("div", { className: "mmxb_panel" },
							react.createElement("span", { className: "mmxb_panelRow" },
								react.createElement("span", { className: "mmxb_panelKey" }, "已桥接"),
								react.createElement("span", { className: "mmxb_panelVal" }, bridgeImages + " 张图片"),
								react.createElement("span", { className: "mmxb_panelKey" }, "落盘目录"),
								react.createElement("span", { className: "mmxb_panelVal" }, outDir)
							),
							react.createElement("code", { className: "mmxb_example" }, "[image.png](" + origin + "/mmx-files/bridge-xxxx.png) 本地文件：" + outDir + "/bridge-xxxx.png")
						)
					),
					react.createElement("div", { className: "mmxb_section" },
						react.createElement("h4", { className: "mmxb_sectionTitle" }, "多模态生成"),
						react.createElement("div", { className: "mmxb_row" },
							react.createElement("span", { className: "mmxb_rowText" },
								react.createElement("span", { className: "mmxb_rowLabel", id: "mmxb-enabled" }, "启用 dsh-mmx-bridge"),
								react.createElement("span", { className: "mmxb_rowHint" }, "关闭后 mmx_bridge 工具拒绝调用。")
							),
							react.createElement(MmxSwitch, { on: visEnabled, disabled: busy, label: "启用插件", onToggle: (v) => toggle("vision", v) })
						),
						react.createElement("div", { className: "mmxb_row" },
							react.createElement("span", { className: "mmxb_rowText" },
								react.createElement("span", { className: "mmxb_rowLabel", id: "mmxb-count" }, "每次生成图片数量"),
								react.createElement("span", { className: "mmxb_rowHint" }, "mmx_bridge（action=image）一次生成张数（1 到 8）。")
							),
							react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flex: "none" } },
								countSaved ? react.createElement("span", { className: "mmxb_saved" }, "已保存") : null,
								react.createElement("input", {
									id: "mmxb-count-input",
									className: "mmxb_input",
									type: "text",
									inputMode: "numeric",
									"aria-invalid": countInvalid ? true : undefined,
									value: draftText,
									disabled: busy,
									onChange: (e) => setDraft(e.target.value)
								}),
								react.createElement("button", {
									type: "button",
									className: "mmxb_action" + (countDirty && !countInvalid ? " mmxb_actionPrimary" : ""),
									disabled: !countDirty || countInvalid || busy,
									onClick: saveCount
								}, "保存")
							)
						),
						countInvalid ? react.createElement("p", { className: "mmxb_failed", role: "status" }, "请输入 1 到 8 之间的整数。") : null
					),
					react.createElement("div", { className: "mmxb_section" },
						react.createElement("h4", { className: "mmxb_sectionTitle" }, "工具接管"),
						react.createElement("div", { className: "mmxb_row" },
							react.createElement("span", { className: "mmxb_rowText" },
								react.createElement("span", { className: "mmxb_rowLabel", id: "mmxb-websearch" }, "web_search 使用 mmx-cli"),
								react.createElement("span", { className: "mmxb_rowHint" }, "默认开启，每个会话的 web_search 改用 mmx-cli。关闭后恢复 DeepSeek 内置搜索。")
							),
							react.createElement(MmxSwitch, { on: webSearchEnabled, disabled: busy, label: "web_search 接管", onToggle: (v) => toggle("websearch", v) })
						),
						react.createElement("div", { className: "mmxb_row" },
							react.createElement("span", { className: "mmxb_rowText" },
								react.createElement("span", { className: "mmxb_rowLabel", id: "mmxb-readimage" }, "read_image 使用 mmx-cli"),
								react.createElement("span", { className: "mmxb_rowHint" }, "默认开启，read_image 改走 MiniMax VLM 返回文字描述。关闭后恢复内置行为（返回图片块）。")
							),
							react.createElement(MmxSwitch, { on: readImageEnabled, disabled: busy, label: "read_image 接管", onToggle: (v) => toggle("readimage", v) })
						)
					),
					statusLine ? react.createElement("p", { className: "mmxb_status" }, statusLine) : null,
					failed ? react.createElement("p", { className: "mmxb_failed", role: "status" }, "错误：" + failed) : null
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
