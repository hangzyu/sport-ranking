(function(global){
'use strict';
let promptEvent=null,callbacks={},lastSave=null,saveOK=true,dialog,body,launch,traditional=false;
const standalone=()=>global.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
const text=(cn,hk)=>traditional?hk:cn;
function make(tag,value){const e=document.createElement(tag);if(value!==undefined)e.textContent=value;return e}
function device(ua=navigator.userAgent){return /MicroMessenger/i.test(ua)?'wechat':/iPhone|iPad|iPod/i.test(ua)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1?'ios':/Android|HarmonyOS/i.test(ua)?'android':'desktop'}
global.addEventListener('beforeinstallprompt',event=>{event.preventDefault();promptEvent=event;if(dialog?.open)paint()});
global.addEventListener('appinstalled',()=>{promptEvent=null;if(launch)launch.textContent='应用与备份';if(dialog?.open)paint()});
function saved(ok){saveOK=ok;if(ok)lastSave=new Date();const status=document.getElementById('localSaveStatus');if(status){status.textContent=ok?'已保存到本机':'保存失败，请立即导出备份';status.dataset.failed=String(!ok)}}
async function backup(blob,filename){
 try{
  const file=new File([blob],filename,{type:'application/json'});
  if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Ranking 赛事备份'});return}
 }catch(error){if(error.name==='AbortError')return}
 const link=make('a');link.href=URL.createObjectURL(blob);link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),60000);
}
function paint(){
 body.replaceChildren();const lang=make('button',traditional?'简体中文':'繁體中文');lang.className='secondary';lang.onclick=()=>{traditional=!traditional;paint()};
 body.append(make('h2',text('安装 Ranking','安裝 Ranking')),lang);
 body.append(make('p',text('添加到手机桌面，下次点图标直接打开。无需应用商店账号。','加至手機主畫面，下次點圖像直接開啟。無需 App Store 帳戶。')));
 const platform=make('select');platform.setAttribute('aria-label',text('选择安装指引','選擇安裝指引'));
 for(const [id,label]of [['wechat',text('微信内打开','微信內開啟')],['ios','iPhone / iPad'],['android',text('安卓／鸿蒙浏览器','Android／HarmonyOS 瀏覽器')],['desktop',text('电脑浏览器','電腦瀏覽器')]]){const o=make('option',label);o.value=id;platform.append(o)}platform.value=device();body.append(platform);
 const steps=make('ol');body.append(steps);
 function instructions(){steps.replaceChildren();let lines;
 if(platform.value==='wechat')lines=[text('点击右上角菜单，尝试“在浏览器中打开”。若没有此入口，复制下方链接。','點右上角選單，嘗試「在瀏覽器中開啟」。若沒有此選項，複製下方連結。'),text('苹果用 Safari；安卓用手机自带浏览器或其他支持安装的浏览器打开。','iPhone 使用 Safari；Android 使用手機瀏覽器或其他支援安裝的瀏覽器開啟。'),text('在浏览器重新打开“安装 Ranking”，按对应指引操作。','在瀏覽器重新開啟「安裝 Ranking」，按對應指引操作。')];
 else if(platform.value==='ios')lines=[text('在 Safari 浏览器打开此网站。','在 Safari 開啟此網站。'),text('打开分享菜单，选择“添加到主屏幕”。找不到时可在菜单中查找或编辑操作。','開啟分享選單，選擇「加至主畫面」。找不到時可在選單中尋找或編輯動作。'),text('若出现“作为网页 App 打开”，将它开启，然后点“添加”。','如出現「作為網頁 App 開啟」，將它開啟，再點「加入」。')];
 else if(platform.value==='android')lines=[text('优先使用本页的“安装到设备”按钮（浏览器支持时显示）。','優先使用本頁的「安裝至裝置」按鈕（瀏覽器支援時顯示）。'),text('没有按钮时，打开浏览器菜单，查找“安装应用”或“添加到桌面”。','沒有按鈕時，開啟瀏覽器選單，尋找「安裝應用程式」或「加至主畫面」。'),text('部分浏览器只能创建桌面快捷方式，或暂不支持安装；仍可通过浏览器使用。','部分瀏覽器只能建立主畫面捷徑，或暫不支援安裝；仍可透過瀏覽器使用。')];
 else lines=[text('在支持的浏览器中使用“安装到设备”，或在浏览器菜单中查找安装应用。','在支援的瀏覽器中使用「安裝至裝置」，或在瀏覽器選單中尋找安裝應用程式。')];
 lines.forEach(line=>steps.append(make('li',line)))}platform.onchange=instructions;instructions();
 if(standalone())body.append(make('p',text('当前已在独立应用窗口中打开。','目前已在獨立應用程式視窗開啟。')));
 else if(promptEvent&&device()!=='wechat'){
  const install=make('button',text('安装到设备','安裝至裝置'));install.onclick=async()=>{const event=promptEvent;promptEvent=null;install.disabled=true;try{await event.prompt();const choice=await event.userChoice;install.textContent=choice.outcome==='accepted'?text('请按系统提示完成安装','請按系統提示完成安裝'):text('已取消，可使用上方手动指引','已取消，可使用上方手動指引')}catch{install.textContent=text('请使用上方手动指引','請使用上方手動指引')}};body.append(install);
 }
 const url=make('input');url.readOnly=true;url.value=new URL('./index.html',location.href).href;url.setAttribute('aria-label',text('网站链接','網站連結'));const copy=make('button',text('复制链接','複製連結'));copy.className='secondary';copy.onclick=async()=>{try{await navigator.clipboard.writeText(url.value);copy.textContent=text('已复制','已複製')}catch{url.select();copy.textContent=text('请长按链接复制','請長按連結複製')}};body.append(url,copy);
 body.append(make('h3',text('先备份，再换设备或浏览器','先備份，再更換裝置或瀏覽器')));
 body.append(make('p',text('赛事仅保存在本机，尚无云端同步。安装后的窗口与原浏览器可能不共享数据；请先导出备份，再到新窗口导入。清除浏览器数据可能丢失赛事。','賽事只儲存在本機，尚無雲端同步。安裝後的視窗與原瀏覽器可能不共用資料；請先匯出備份，再到新視窗匯入。清除瀏覽器資料可能遺失賽事。')));
 const buttons=make('div');buttons.className='install-actions';
 for(const [cn,hk,fn]of [['导出当前赛事','匯出目前賽事',()=>callbacks.backup()],['导入备份','匯入備份',()=>{dialog.close();callbacks.restore()}]]){const b=make('button',text(cn,hk));b.className='secondary';b.onclick=fn;buttons.append(b)}body.append(buttons);
 body.append(make('p',saveOK?(lastSave?text('最近保存：','最近儲存：')+lastSave.toLocaleTimeString():text('使用页面顶部的“保存赛事”保存。','使用頁面頂部的「保存赛事」儲存。')):text('保存失败，请先导出备份，避免刷新丢失修改。','儲存失敗，請先匯出備份，避免重新整理遺失修改。')));
 const storage=make('button',text('申请保留本机数据','申請保留本機資料'));storage.className='secondary';storage.onclick=async()=>{try{const ok=await navigator.storage?.persist?.();storage.textContent=ok?text('已获得保留权限，仍建议备份','已取得保留權限，仍建議備份'):text('未获得保留权限，请定期备份','未取得保留權限，請定期備份')}catch{storage.textContent=text('请定期导出备份','請定期匯出備份')}};body.append(storage);
 body.append(make('h3',text('更新与网络','更新與網絡')));
 body.append(make('p',navigator.onLine?text('当前在线。离线时仅能使用已经缓存的功能；首次使用出线推演需要联网加载组件。','目前在線。離線時只能使用已快取的功能；首次使用出線推演需要連線載入元件。'):text('当前离线。仅能使用已缓存的功能；请联网后检查更新。','目前離線。只能使用已快取的功能；請連線後檢查更新。')));
 const update=make('button',text('保存并检查更新','儲存並檢查更新'));update.onclick=async()=>{if(!callbacks.save()){paint();return}update.disabled=true;try{const reg=await navigator.serviceWorker?.getRegistration();if(reg)await reg.update();update.textContent=text('已保存，点击重新打开','已儲存，點擊重新開啟');update.disabled=false;update.onclick=()=>{if(callbacks.save())location.reload()}}catch{update.disabled=false;update.textContent=text('检查失败，请联网后重试','檢查失敗，請連線後重試')}};body.append(update);
}
function init(options){callbacks=options;const actions=document.querySelector('.header-actions');if(!actions)return;
 launch=make('button',standalone()?'应用与备份':'安装 Ranking');launch.id='installRanking';launch.onclick=()=>{paint();dialog.showModal()};actions.prepend(launch);
 const status=make('span');status.id='localSaveStatus';status.setAttribute('role','status');status.className='save-status';actions.append(status);saved(saveOK);
 dialog=make('dialog');dialog.className='install-dialog';dialog.setAttribute('aria-label','安装 Ranking 与赛事备份');const close=make('button','×');close.className='install-close secondary';close.setAttribute('aria-label','关闭');close.onclick=()=>dialog.close();body=make('div');dialog.append(close,body);document.body.append(dialog);
 global.addEventListener('online',()=>{if(dialog.open)paint()});global.addEventListener('offline',()=>{if(dialog.open)paint()});
}
global.RankingInstall={init,saved,backup,device};
})(globalThis);
