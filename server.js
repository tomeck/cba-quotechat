// For running an Express server and handling API requests
var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var rp = require('request-promise');

// Basic utilities
var util = require('util');
var cfenv = require('cfenv'); // Get access to Cloud Foundry runtime environment
var twilio = require('twilio'); // Twilio integration
var numeral = require('numeral');  // numeric formatting

// Watson Conversation
var Conversation = require('watson-developer-cloud/conversation/v1');

// Get the app environment from Cloud Foundry
var appEnv = cfenv.getAppEnv();

var URL_GET_XIGNITE_LAST_PRICES = 'http://globalquotes.xignite.com/v3/xGlobalQuotes.json/GetGlobalDelayedQuotes';

// Establish Watson Conversation connection
var conversation = new Conversation({
  username: conversationUsername,
  password: conversationPassword,
  version_date: Conversation.VERSION_DATE_2017_02_03
});

// Send response back to Twilio request
function sendTwilioResponse(data, res) {
  // Compose the response to Twilio that will be SMS'd back to originator
  var twiml = new twilio.TwimlResponse();
  twiml.message(data);
  res.writeHead(200, {'Content-Type': 'text/xml'});
  res.end(twiml.toString());

  console.log("Wrote message back to Twilio: ", data);
  console.log('-----------------');
}

function getXigniteLastPricesRP(symbols) {

  var options = {
      uri: URL_GET_XIGNITE_LAST_PRICES,
      qs: {
        "IdentifierType": "Symbol", "Identifiers": symbols,
          "_fields": "Security.Symbol,Date,Time,Last,PreviousClose,ChangeFromPreviousClose,PercentChangeFromPreviousClose", "_Token":CRED_XIGNITE_TOKEN
      },
      json: true // Automatically parses the JSON string in the response
  };

  return rp(options);
}

function getSymbolPrice(symbol, res) {
  // Invoke Xignite API to get prices of the supplied stock symbol
  getXigniteLastPricesRP(symbol)
    .then(function(prices) {
      console.log("Xignite response: ", prices);

      if( prices.length > 0 && prices[0].Last > 0) {
        var price = prices[0];
        var strprice = numeral(price.Last).format('$0,0.00');
        var diffprice = numeral(price.ChangeFromPreviousClose).format('$0,0.00');
        //var msg = 'The last price of ' + symbol + ' is ' + price + ' at ';
        var msg = util.format( '%s was %s at %s on %s (a difference of %s from previous closing price)',
            symbol, strprice, price.Time, price.Date, diffprice
        );
        sendTwilioResponse(msg, res);
      }
      else {
        sendTwilioResponse('Sorry, I was unable to get a price for the symbol ' + symbol, res);
      }
    })
    .catch(function (err) {
        // API call failed...
        console.log("Inner Error", err.message);
    })
}

// Setup the Express application instance
var app = express();

// Twilio posts XML so that's how we'll parse the incoming request
app.use( bodyParser.urlencoded({ extended: true }));

// Twilio will POST to the /sms resource when it receives an SMS message
// The content-type is FORM-URLENCODED
app.post('/sms', function(req, res) {
  //console.log('Content-Type: ' + req.headers['content-type']);

  // The request ('req') is FORM-URLENCODED as per Twilio POST format
  var phoneNum = req.body.From;
  phoneNum = phoneNum.replace(/\D/g,''); // strip all non-numeric chars
  var inBody = req.body.Body;

  console.log('-----------------');
  console.log('/SMS Input received: ' + inBody + ' from ' + phoneNum );

  // Send the input to the conversation service
  conversation.message({
      input: { text: inBody },
      context : null,
      workspace_id: conversationWorkspace
    }, function(err, convResponse) {
      var responseMsg;

      // Handle error returned from Watson Conversation
      if (err) {
        console.error('Something bad happened, got an err: ' + JSON.stringify(err, null, 2));
        responseMsg = JSON.stringify(err, null, 2);
        sendTwilioResponse(responseMsg, res);
      }
      else {

        // Extract response returned by Watson
        responseMsg = convResponse.output.text[0];

        var firstIntent = (convResponse.intents != null && convResponse.intents.length>0 ) ? convResponse.intents[0] : null;
        var intentName = (firstIntent != null) ? firstIntent.intent : "";
        var intentConfidence = (firstIntent != null) ? firstIntent.confidence : "";

        var firstEntity = (convResponse.entities != null && convResponse.entities.length>0 ) ? convResponse.entities[0] : null;
        var entityName = (firstEntity != null) ? firstEntity.entity : "";
        var entityValue= (firstEntity != null) ? firstEntity.value : "";

        var conversationId = convResponse.context.conversation_id;
        console.log('Detected intent {' + intentName + '} with confidence ' + intentConfidence);
        console.log('Detected entity {' + entityName + '} with value {' + entityValue + "}");
        console.log('Conversation id = ' + conversationId);
        console.log('Conversation context = ' + JSON.stringify(convResponse.context));
        //console.log('Response will be: ' + responseMsg);
        //console.log(convResponse);
        //console.log(convResponse.context);

        if( "getprice" == intentName ) {
          console.log('*** ACTION: YAY GET PRICE CALLED on', entityValue);
          getSymbolPrice(entityValue, res);
        }
        else {
          // Send back the response we got from Watson Conversation
          sendTwilioResponse(responseMsg, res);
        }
      } // else-not err
    }) // function(err, convResponse), conversation.message()
}); // app.post()

// Start server on host and port specified in CF config
// or Express defaults when running locally
app.listen(appEnv.port, '0.0.0.0', function() {
  console.log("server starting on " + appEnv.url);
});
