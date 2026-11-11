/* Motion for every public screen except Home (Home has its own motion, inside index.html). Loaded by index.html as assets/page-fx.js?v=1:
   BUMP THE NUMBER whenever this file changes.
     - PageFX.enter(step): called at the end of render(). A SHORT entrance (the heading, then each block, about 0.6 s in all) that plays only when the
       screen really changes, or when its content first arrives (e.g. the payment details finish loading). A redraw of the same screen (a typo
       message, a chosen file, a ticked box) never replays it, because render() is called in about 60 places.
       Blocks that the scroll-reveal hides (class rv, below the fold) are left to that, so nothing is animated twice.
     - a soft press ripple on every button and button-like link (the press-in is CSS in index.html).
   Nothing here runs for visitors who ask for reduced motion. */
(()=>{
const RM=matchMedia("(prefers-reduced-motion:reduce)");
let prevStep="",prevCards=false;
function enter(step){
  const a=document.getElementById("app");if(!a)return;
  const cards=a.querySelector(".card")!==null,fresh=step!==prevStep||(cards&&!prevCards);
  prevStep=step;prevCards=cards;
  if(RM.matches||!fresh||step==="home"||step==="loading")return;
  const kf=[{opacity:0,transform:"translateY(12px)"},{opacity:1,transform:"none"}];
  [...a.children].forEach((el,i)=>{if(el.classList.contains("rv"))return;
    try{el.animate(kf,{duration:420,easing:"cubic-bezier(.2,.8,.2,1)",fill:"backwards",delay:Math.min(i,5)*55})}catch(_){}});
}
document.addEventListener("pointerdown",e=>{
  if(RM.matches)return;const t=e.target;if(!t||!t.closest)return;
  const b=t.closest("button,a.btn");if(!b||b.disabled||b.getAttribute("aria-disabled")==="true")return;
  const r=b.getBoundingClientRect(),d=Math.max(r.width,r.height)*2.2,s=document.createElement("span");
  s.className="fxr";s.setAttribute("aria-hidden","true");
  s.style.cssText=`width:${d}px;height:${d}px;left:${e.clientX-r.left-d/2}px;top:${e.clientY-r.top-d/2}px`;b.appendChild(s);
  try{s.animate([{transform:"scale(0)",opacity:.5},{transform:"scale(1)",opacity:0}],{duration:600,easing:"ease-out"}).onfinish=()=>s.remove()}catch(_){s.remove()}
  setTimeout(()=>s.remove(),900);
},{passive:true});
window.PageFX={enter};
})();
