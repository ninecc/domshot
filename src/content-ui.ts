import type { UiLocale } from './types';
import { t } from './i18n';

const UI_FONT = 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif';

export function contentUiStyleTags(surface: 'preview' | 'toast'): string {
  const surfaceStyles = surface === 'preview'
    ? `<style>${previewStyles()}</style><style>${previewInteractionStyles()}</style>`
    : `<style>${toastStyles()}</style><style>.toast button{min-height:32px;padding:0 6px}</style>`;
  return `${sharedStyles()}${surfaceStyles}<style>${themeStyles()}</style>`;
}

function sharedStyles() {
  return `<style>:host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:${UI_FONT};color:#0f172a}*{box-sizing:border-box}button{font:inherit}button:focus-visible{outline:3px solid rgba(37,99,235,.35);outline-offset:2px}</style>`;
}

export function selectorMarkup(locale: UiLocale) {
  return `
    ${sharedStyles()}
    <style>
      :host{cursor:crosshair}.outline{position:fixed;left:0;top:0;display:none;border:2px solid #2563eb;background:rgba(37,99,235,.1);box-shadow:0 0 0 1px rgba(255,255,255,.9),inset 0 0 0 1px rgba(139,92,246,.25);transition:width .06s,height .06s,transform .06s}.outline.capturing{animation:pulse .7s infinite alternate}.element-label{position:fixed;left:0;top:0;display:none;max-width:300px;padding:5px 8px;border-radius:6px;color:#fff;background:linear-gradient(135deg,#2563eb,#7c3aed);font:600 10px/1.3 ui-monospace,SFMono-Regular,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.toolbar{position:fixed;left:50%;top:18px;padding:11px 16px;border:1px solid rgba(255,255,255,.72);border-radius:13px;color:#0f172a;background:rgba(255,255,255,.96);box-shadow:0 12px 34px rgba(15,23,42,.18);transform:translateX(-50%);pointer-events:auto}.toolbar strong,.toolbar small{display:block}.toolbar strong{font-size:12px}.toolbar small{color:#64748b;font-size:9px;margin-top:2px}@keyframes pulse{to{background:rgba(139,92,246,.22)}}.spinner{float:left;width:17px;height:17px;margin:2px 10px 0 0;border:2px solid #dbe5f7;border-top-color:#2563eb;border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.outline{transition:none}.spinner{animation-duration:1.5s}}
    </style>
    <style>${themeStyles()}</style>
    <div class="outline"></div><div class="element-label"></div>
    <div class="toolbar"><strong>${t(locale, 'selectElementToolbar')}</strong><small>${t(locale, 'moveClick')}</small></div>`;
}

function previewStyles() {
  return `
    :host{position:fixed;inset:auto;left:var(--domshot-viewport-left,0);top:var(--domshot-viewport-top,0);display:flex;box-sizing:border-box;width:var(--domshot-viewport-width,100vw);height:var(--domshot-viewport-height,100vh);align-items:flex-end;justify-content:flex-end;padding:calc(18px * var(--domshot-ui-scale,1))}.preview-card{width:336px;flex:none;padding:12px;border:1px solid #dfe5ee;border-radius:18px;background:#f8fafc;box-shadow:0 18px 52px rgba(15,23,42,.24);transform:scale(var(--domshot-ui-scale,1));transform-origin:right bottom;pointer-events:auto}.preview-head{display:flex;align-items:center;justify-content:space-between;padding:2px 3px 10px;font-size:13px}.status-dot{display:inline-grid;place-items:center;width:21px;height:21px;margin-right:7px;border-radius:50%;color:#fff;background:#10b981;font-weight:900}.has-resource-warning .status-dot{background:#f59e0b}.is-authorizing .status-dot{background:linear-gradient(135deg,#2563eb,#8b5cf6)}.icon-button{width:26px;height:26px;border:0;border-radius:8px;color:#64748b;background:transparent;font-size:20px;cursor:pointer}.image-stage{display:flex;align-items:center;justify-content:center;height:196px;padding:10px;border:1px solid #dfe5ee;border-radius:12px;background:repeating-conic-gradient(#e8edf4 0 25%,#fff 0 50%) 50%/14px 14px;overflow:hidden}.image-stage img{display:block;max-width:100%;max-height:100%;border-radius:3px;box-shadow:0 5px 18px rgba(15,23,42,.16)}.resource-warning{display:grid;gap:7px;margin:8px 0 0;padding:8px 10px;border:1px solid #fde68a;border-radius:9px;color:#92400e;background:#fffbeb;font-size:10px;line-height:1.45}.grant-images{min-height:31px;border:1px solid #f3c44e;border-radius:8px;color:#78350f;background:#fff;font-size:9px;font-weight:800;cursor:pointer}.grant-images:hover{border-color:#d79b16;background:#fffcf2}.grant-images:disabled{cursor:wait;opacity:.65}.permission-panel{display:grid;gap:5px}.permission-panel[hidden]{display:none}.permission-panel iframe{display:block;width:100%;height:292px;border:0;border-radius:12px;background:#f8fafc}.open-permission-window{min-height:25px;border:0;color:#64748b;background:transparent;font-size:8px;cursor:pointer}.open-permission-window:hover{color:#2563eb;text-decoration:underline;text-underline-offset:2px}.is-authorizing .image-stage,.is-authorizing .resource-warning,.is-authorizing .meta,.is-authorizing .history-retention,.is-authorizing .preview-actions,.is-authorizing .feedback{display:none}.meta{display:flex;justify-content:space-between;gap:8px;padding:10px 2px 7px;color:#64748b;font:9px ui-monospace,SFMono-Regular,monospace}.meta span{max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-retention{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 2px 8px;padding-top:7px;border-top:1px solid #e5eaf1;color:#64748b;font-size:8px;line-height:12px}.history-retention-toggle{min-height:24px;padding:0 8px;border:1px solid #cbd5e1;border-radius:7px;color:#475569;background:#fff;font-size:8px;font-weight:800;cursor:pointer;transition:border-color .15s ease,color .15s ease,background-color .15s ease,box-shadow .15s ease}.history-retention-toggle:hover{border-color:#93b4f5;color:#1d4ed8;background:#eff6ff;box-shadow:0 3px 10px rgba(37,99,235,.1)}.history-retention-toggle[data-state="remove"]:hover{border-color:#fca5a5;color:#b91c1c;background:#fff1f2;box-shadow:0 3px 10px rgba(239,68,68,.08)}.history-retention-toggle:disabled{cursor:wait;opacity:.55}.preview-actions{display:grid;grid-template-columns:1fr 1.2fr;gap:8px}.preview-actions button{min-height:38px;border:1px solid #d6deea;border-radius:10px;color:#0f172a;background:#fff;font-size:11px;font-weight:800;cursor:pointer}.preview-actions .copy.is-success{border-color:#86efac;color:#047857;background:#ecfdf5}.preview-actions .download{border:0;color:#fff;background:linear-gradient(135deg,#2563eb,#8b5cf6)}.feedback{height:0;margin:0;color:#10b981;font-size:9px;text-align:center;opacity:0;transition:.15s}.feedback:not(:empty){height:21px;padding-top:8px;opacity:1}.feedback.is-error{color:#ef4444}.copy-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(prefers-reduced-motion:reduce){.history-retention-toggle,.preview-actions button,.feedback{transition:none}}`;
}

function previewInteractionStyles() {
  return `
    .icon-button{display:grid;place-items:center;width:32px;height:32px;padding:0;line-height:1;transition:color .15s ease}
    .grant-images,.open-permission-window,.history-retention-toggle{min-height:32px}
    .icon-button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
    .icon-button:hover{color:#2563eb;background:transparent}
    .preview-actions button{transition:border-color .15s ease,background-color .15s ease,color .15s ease,box-shadow .15s ease,filter .15s ease}
    .preview-actions .download{border:1px solid transparent}
    .preview-actions button:hover{transform:none;border-color:#b7c9f7;box-shadow:0 7px 18px rgba(37,99,235,.1)}
    .preview-actions .download:not(.is-success):not(.is-error):hover{filter:brightness(.9) saturate(1.08);box-shadow:0 8px 20px rgba(37,99,235,.22)}
    .preview-actions button.is-success{border-color:#86efac;color:#047857;background:#ecfdf5}
    .preview-actions button.is-error{border-color:#fecaca;color:#b91c1c;background:#fff1f2}
    .action-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @media(prefers-reduced-motion:reduce){.preview-actions button{transition:none}}
  `;
}

function themeStyles() {
  return `
    :host([data-domshot-theme="dark"]){color:#e6edf8}
    :host([data-domshot-theme="dark"]) .toolbar,
    :host([data-domshot-theme="dark"]) .toast{border-color:#334155;color:#e6edf8;background:rgba(15,23,42,.97);box-shadow:0 12px 34px rgba(0,0,0,.38)}
    :host([data-domshot-theme="dark"]) .toolbar small,
    :host([data-domshot-theme="dark"]) .toast small,
    :host([data-domshot-theme="dark"]) .meta{color:#94a3b8}
    :host([data-domshot-theme="dark"]) .preview-card{border-color:#334155;color:#e6edf8;background:#0f172a;box-shadow:0 18px 52px rgba(0,0,0,.48)}
    :host([data-domshot-theme="dark"]) .icon-button{color:#94a3b8}
    :host([data-domshot-theme="dark"]) .icon-button:hover{color:#60a5fa;background:transparent}
    :host([data-domshot-theme="dark"]) .image-stage{border-color:#334155;background:repeating-conic-gradient(#1e293b 0 25%,#0b1220 0 50%) 50%/14px 14px}
    :host([data-domshot-theme="dark"]) .resource-warning{border-color:#854d0e;color:#fcd34d;background:#2a1f0b}
    :host([data-domshot-theme="dark"]) .grant-images{border-color:#a16207;color:#fde68a;background:#1c1917}
    :host([data-domshot-theme="dark"]) .grant-images:hover{border-color:#d97706;background:#29200f}
    :host([data-domshot-theme="dark"]) .permission-panel iframe{background:#0f172a}
    :host([data-domshot-theme="dark"]) .open-permission-window{color:#94a3b8}
    :host([data-domshot-theme="dark"]) .history-retention{border-color:#26354a;color:#94a3b8}
    :host([data-domshot-theme="dark"]) .history-retention-toggle{border-color:#334155;color:#cbd5e1;background:#111b2b}
    :host([data-domshot-theme="dark"]) .history-retention-toggle:hover{border-color:#60a5fa;color:#bfdbfe;background:#16243a;box-shadow:0 3px 12px rgba(37,99,235,.2)}
    :host([data-domshot-theme="dark"]) .history-retention-toggle[data-state="remove"]:hover{border-color:#ef4444;color:#fecaca;background:#3f1118;box-shadow:0 3px 12px rgba(239,68,68,.12)}
    :host([data-domshot-theme="dark"]) .preview-actions button{border-color:#334155;color:#e6edf8;background:#111b2b}
    :host([data-domshot-theme="dark"]) .preview-actions .download{border:1px solid transparent;color:#fff;background:linear-gradient(135deg,#2563eb,#7c3aed)}
    :host([data-domshot-theme="dark"]) .preview-actions button:not(.is-success):not(.is-error):hover{border-color:#60a5fa;background:#16243a;box-shadow:0 7px 18px rgba(37,99,235,.2)}
    :host([data-domshot-theme="dark"]) .preview-actions .download:not(.is-success):not(.is-error):hover{border-color:#93c5fd;color:#fff;background:linear-gradient(135deg,#1d4ed8,#6d28d9);filter:brightness(.96) saturate(1.08);box-shadow:0 8px 20px rgba(37,99,235,.3)}
    :host([data-domshot-theme="dark"]) .preview-actions button.is-success{border-color:#166534;color:#6ee7b7;background:#063b2c}
    :host([data-domshot-theme="dark"]) .preview-actions button.is-error{border-color:#991b1b;color:#fca5a5;background:#3f1118}
    :host([data-domshot-theme="dark"]) .toast.error{border-color:#7f1d1d;background:#2b1116}
    :host([data-domshot-theme="dark"]) .toast button{color:#60a5fa}
    :host([data-domshot-theme="dark"]) .outline{border-color:#60a5fa;background:rgba(37,99,235,.16);box-shadow:0 0 0 1px rgba(15,23,42,.95),inset 0 0 0 1px rgba(167,139,250,.3)}
  `;
}

function toastStyles() {
  return `
    :host{display:flex;align-items:flex-start;justify-content:center;padding-top:18px}.toast{display:flex;align-items:center;gap:11px;min-width:270px;padding:12px 15px;border:1px solid #dfe5ee;border-radius:13px;color:#0f172a;background:rgba(255,255,255,.97);box-shadow:0 12px 34px rgba(15,23,42,.2);pointer-events:auto}.toast strong,.toast small{display:block}.toast strong{font-size:12px}.toast small{max-width:340px;margin-top:3px;color:#64748b;font-size:9px}.spinner{width:18px;height:18px;border:2px solid #dbe5f7;border-top-color:#2563eb;border-radius:50%;animation:spin .7s linear infinite}.error-mark{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;color:#fff;background:#ef4444;font-weight:900}.toast button{margin-left:auto;border:0;color:#2563eb;background:none;font-size:10px;cursor:pointer}.compact{min-width:auto}.error{border-color:#fecaca;background:#fff7f7}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation-duration:1.5s}}`;
}
