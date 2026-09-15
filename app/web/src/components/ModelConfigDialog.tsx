import React, { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, X } from "lucide-react";

type ModelConfig = { provider: string; modelId: string; baseUrl: string; keyConfigured: boolean };
type TeachMateBridge = { getModelConfig: () => Promise<ModelConfig>; saveModelConfig: (config: Record<string, string>) => Promise<ModelConfig>; onOpenModelConfig?: (callback: () => void) => () => void };

function bridge(): TeachMateBridge | null {
  return (window as Window & { teachmate?: TeachMateBridge }).teachmate || null;
}

export function ModelConfigDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [provider, setProvider] = useState("deepseek");
  const [modelId, setModelId] = useState("deepseek-flash");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com");
  const [apiKey, setApiKey] = useState("");
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void bridge()?.getModelConfig().then((config) => {
      setProvider(config.provider);
      setModelId(config.modelId);
      setBaseUrl(config.baseUrl);
      setKeyConfigured(config.keyConfigured);
    });
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bridge()) {
      setMessage("请在 TeachMate 桌面客户端中配置 AI 模型。");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await bridge()!.saveModelConfig({ provider, modelId, baseUrl, apiKey });
      setKeyConfigured(result.keyConfigured);
      setApiKey("");
      setMessage("已保存，后续批改会使用新的模型配置。");
      onSaved();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-blue-600" /><div><h2 className="font-bold text-slate-900">配置 AI 模型</h2><p className="text-xs text-slate-500">密钥只保存在本机，不会显示或上传</p></div></div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </div>
      <form onSubmit={save} className="space-y-4 px-6 py-5">
        <label className="block text-sm font-semibold text-slate-700">模型服务商<input value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal outline-none focus:border-blue-500" /></label>
        <label className="block text-sm font-semibold text-slate-700">模型 ID<input value={modelId} onChange={(e) => setModelId(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal outline-none focus:border-blue-500" /></label>
        <label className="block text-sm font-semibold text-slate-700">接口地址<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal outline-none focus:border-blue-500" /></label>
        <label className="block text-sm font-semibold text-slate-700">API Key {keyConfigured && <span className="font-normal text-emerald-600">（已配置，留空则保持不变）</span>}<span className="relative mt-1.5 block"><input type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyConfigured ? "已保存，输入新密钥可替换" : "请输入 API Key"} className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-10 font-normal outline-none focus:border-blue-500" required={!keyConfigured} /><button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-2 top-2 text-slate-400">{showKey ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button></span></label>
        {message && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</p>}
        <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">取消</button><button disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "保存中…" : "保存配置"}</button></div>
      </form>
    </div>
  </div>;
}
