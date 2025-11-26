let currentUser = null;
const ownerEmail = 'harshamirage@gmail.com';
const ownerPassword = 'harshamirage@2011';

function openPage(id){
  document.querySelectorAll('.page').forEach(p=>p.style.display='none');
  document.getElementById(id).style.display='block';
}
openPage('loginPage');

document.getElementById('loginBtn').addEventListener('click', async ()=>{
  const email = document.getElementById('loginEmail').value;
  const pass = document.getElementById('loginPass').value;
  if(email===ownerEmail && pass===ownerPassword){
    currentUser={email,username:'Harshvardhan',isOwner:true};
  }else{
    currentUser={email,username:email.split('@')[0],isOwner:false};
  }
  openPage('home');
  await loadQA();
});

document.getElementById('logoutBtn').addEventListener('click', ()=>{
  currentUser=null;
  openPage('loginPage');
});

document.getElementById('postQBtn').addEventListener('click', async ()=>{
  const q=document.getElementById('qInput').value;
  if(!q||!currentUser) return;
  await fetch('/qa',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:q,user:currentUser})
  });
  document.getElementById('qInput').value='';
  loadQA();
});

async function loadQA(){
  const res = await fetch('/data');
  const data = await res.json();
  const qaBoard = document.getElementById('qaBoard');
  qaBoard.innerHTML='';
  data.qaList.forEach((item,i)=>{
    const div = document.createElement('div');
    const pfp = item.user.pfp ? `<img src="${item.user.pfp}" width="40" height="40" style="border-radius:50%;margin-right:6px;vertical-align:middle">` : '';
    div.innerHTML=`${pfp}<strong>${item.user.username}:</strong> ${item.question}<br>${item.answer ? '<em>Answer:</em> '+item.answer : ''}`;
    if(currentUser?.isOwner){
      const btn=document.createElement('button');
      btn.innerText='Reply';
      btn.onclick=async ()=>{
        const a=prompt('Enter answer:', item.answer||'');
        if(a!==null){
          await fetch('/qa/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({index:i,answer:a})});
          loadQA();
        }
      };
      div.appendChild(btn);
    }
    qaBoard.appendChild(div);
  });
}

document.getElementById('sendMsgBtn').addEventListener('click', async ()=>{
  const group=document.getElementById('chatGroup').value;
  const text=document.getElementById('chatText').value;
  if(!group||!text||!currentUser) return;
  await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({group,message:{user:currentUser,text}})});
  document.getElementById('chatText').value='';
  loadChat(group);
});

async function loadChat(group){
  const res = await fetch(`/chat/${group}`);
  const data = await res.json();
  const messages = document.getElementById('messages');
  messages.innerHTML='';
  data.forEach(m=>{
    const pfp = m.user.pfp ? `<img src="${m.user.pfp}" width="30" height="30" style="border-radius:50%;margin-right:4px;vertical-align:middle">` : '';
    messages.innerHTML+=`${pfp}<strong>${m.user.username}:</strong> ${m.text}<br>`;
  });
}

document.getElementById('saveProfileBtn').addEventListener('click', async ()=>{
  if(!currentUser) return;
  const name = document.getElementById('nameInput').value;
  const username = document.getElementById('userInput').value;
  const pfp = document.getElementById('pfpInput').value;
  await fetch('/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:currentUser.email,username,name,pfp})});
  currentUser={...currentUser,username,name,pfp};
  alert('Profile updated!');
});
