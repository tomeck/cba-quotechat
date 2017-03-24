// For running an Express server and handling API requests
var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var rp = require('request-promise');

// Basic utilities
var util = require('util');
var HashMap = require('hashmap');
var cfenv = require('cfenv'); // Get access to Cloud Foundry runtime environment
var mcache = require('memory-cache'); // For maintaining state of a Conversation
var twilio = require('twilio'); // Twilio integration
var numeral = require('numeral');  // numeric formatting

// Watson Conversation
var Conversation = require('watson-developer-cloud/conversation/v1');

// For plotting
var fs = require('fs');
var tmp = require('tmp');

// Cloudant
var Cloudant = require('cloudant');

// Get the app environment from Cloud Foundry
var appEnv = cfenv.getAppEnv();

// JTE TODO - read Env Vars from cfenv
var conversationUsername = 'dc548aa2-5d98-47cc-9ed8-7bbbef156f0f';  // PREV 'e7628040-92ad-4a01-8415-467b78ee3110';
var conversationPassword = 'HQ4vjlsxTz0r'; // PREV 'qGz4gBDXiHHi';
var conversationWorkspace = '3df796e8-9e9a-40ea-96f3-39a9c4706824';  // cogcov 'd0b8c93b-f4f2-4689-b980-3cedfb519d0d'// CBA food ordering 'ba1d1b65-2ce5-4901-8377-2de214dea244';

// --- Portfolio and Xignite API CREDENTIALS JTE TODO REMOVE
var CRED_PORTFOLIO_USERID = 'hindesequallsompaideirdl';  // PROD-OLD'bitchabbirigentedurtespa'; // "willowarimanctietteadded";
var CRED_PORTFOLIO_PWD = '3bbff2964bb82ffe2dddc291151487503c54d564';  // PROD-OLD '6c395fe4c3f95849e3a85f1bd3c9fe2460f5820a'; //"88177d8581ae4165d6a620142d7029fc085c443f";
var CRED_XIGNITE_TOKEN = "0BE12B58D70D405AB0892D0D1A8DBA93";
// ---

// --- Plot.ly CREDENTIALS JTE TODO REMOVE
var PLOTLY_USERID = "teck-bioteck";
var PLOTLY_APIKEY = "RZ3JySoq5EPKTsM8BTSi";
var plotly = require('plotly')(PLOTLY_USERID, PLOTLY_APIKEY);

// JTE TODO - read this from config
//-STAGING var URL_GET_PORTFOLIO_HOLDINGS = 'http://fss-portfolio-service-doc.stage1.ng.bluemix.net/api/v1/portfolios';
var URL_GET_PORTFOLIO_HOLDINGS = 'https://investment-portfolio.mybluemix.net/api/v1/portfolios';

var URL_GET_XIGNITE_LAST_PRICES = 'http://globalquotes.xignite.com/v3/xGlobalQuotes.json/GetGlobalDelayedQuotes';

// ---
// JTE TODO read these from config/CF_VARS
//var cloudant = Cloudant({instanceName: 'foo', vcapServices: JSON.parse(process.env.VCAP_SERVICES)});
//var cloudantUserid = '1f2a0c06-9eda-4462-a0bd-cb4b7e1a9f4d-bluemix'; // Set this to your own account
//var cloudantPwd = '00fcd2647bfdecea02c8da6c0c6a20aef47eb75e5b9048f0de81746024edcf73';
var CLOUDANT_URL = 'https://1f2a0c06-9eda-4462-a0bd-cb4b7e1a9f4d-bluemix:00fcd2647bfdecea02c8da6c0c6a20aef47eb75e5b9048f0de81746024edcf73@1f2a0c06-9eda-4462-a0bd-cb4b7e1a9f4d-bluemix.cloudant.com';

// Initialize Cloudant db connection// Initialize the library with my account.
//var cloudant = Cloudant({account:me, password:password}, plugin:'promises');
var cloudant = Cloudant({url: CLOUDANT_URL, plugin:'promises'});
var dbCustomers = cloudant.db.use('customers');

// JTE TODO read these from config/CF_VARS
var RISK_ANALYTICS_URL = 'https://fss-analytics.mybluemix.net/api/v1/scenario/instrument';  //STAGING 'https://fss-analytics.stage1.mybluemix.net/api/v1/scenario/instrument';
var RISK_ANALYTICS_TOKEN =  'ff523902a589e301fbad094c2f2dbdef37a8f74dfc607ee6b34244c4a59eff76b64f9d0b42a336fec7f4d331270ac760b2e8c2a11fb2d4a996b90588e3bda267e3fb0f42fb44f4c0ec1a271ff94a39eb0f365e9f3643f629f84ee9c0a8cf632f19c442b4abacca9c9fe09996c79dd387591ccb19635a2c19d43afdfa874c0824'; // STAGING:'32162467d5195636499ea32be87bf3019fb87252d62d86e0ac3471568a853239c78d856b90527be40d9b46c5df267e05b911a63078c0db5da64537aa90c3d07a23dcfeada3d247bd0fac2814aa39ca2b72098c12f1c098a83c51f7d6ae77e8aef4fc6184c2e00c4347d9907cbb8daa1f1dbf6a2aca74f3cbda7cd9a0eaedcc59';
var ANALYTICS_SCENARIO_FILENAME = './conditional_out.csv'; // the only analytics scenario supported today

// --- Other config items
var MAX_TOP_HOLDINGS = 5; // only return the top 'MAX_TOP_HOLDINGS' largest positions
var SESSION_IDLE_TIMEOUT_MS = 50000; // reset the "session" if haven't exchanged msg with a phone # for this amt of time

// Establish Watson Conversation connection
var conversation = new Conversation({
  username: conversationUsername,
  password: conversationPassword,
  version_date: Conversation.VERSION_DATE_2017_02_03
});

// Emoji symbols
var EMOJI_MONEY_STACK = [55357,56501]; // '💵';
var EMOJI_MONEY_BAG = [55357,56496]; // '💰';
var EMOJI_LINE_GRAPH = [55357,56520]; // '📈;
var EMOJI_DOWN_ARROW =  '⬇️';
var EMOJI_UP_ARROW =  '⬆️';
var EMOJI_MODERATE_SMILE =  '😀';

// ----
// Helper functions
// ----
function getSessionContext(phoneNum) {

  console.log('Enter getSessionContext with',phoneNum);

  // Attempt to get session context from cache
  var sessionContext = mcache.get(phoneNum) || null;

  // On cache miss...
  if( sessionContext == null ) {

    console.log('SessionContext not found');

    // Return a promise to fetch customer profile from db and stick into cache
    return dbCustomers.find({selector:{_id:phoneNum}})
      .then(function(data) {

        var userProfile = null;  // If not found, Initialize empty context
        if(data.docs.length>0) {
          // Populate user profile
          userProfile = {'name':data.docs[0].name, 'portfolio':data.docs[0].portfolio};
          //console.log("rows found:", data.docs.length);
          //console.log("first row", data.docs[0]);
          //console.log("first name", data.docs[0].name);
          //console.log("first portfolio", data.docs[0].portfolio);
        }
        else {
          console.log('getSessionContext failed to find profile for',phoneNum);
        }

        // Set context into cache
        sessionContext = { 'userProfile':userProfile, 'conversationContext':null };
        mcache.put(phoneNum, sessionContext,SESSION_IDLE_TIMEOUT_MS,
          function(key, value) {console.log('1cache was cleared for',key);});
        console.log('initialized context for', phoneNum);
    })
  }
  else {
    console.log('SessionContext found', sessionContext);

    // Return a promise that is fulfilled with 'sessionContext'
    return Promise.resolve(sessionContext);
  }
}

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

// Send response back to Twilio request
function sendTwilioResponseWithMedia(data, mediaUrl, res) {
  // Compose the response to Twilio that will be SMS'd back to originator
  var twiml = new twilio.TwimlResponse();
  twiml.message(function(){
    this.body(data);
    this.media(mediaUrl);
  });
  res.writeHead(200, {'Content-Type': 'text/xml'});
  res.end(twiml.toString());

  console.log("Wrote message back to Twilio: ", data);
  console.log('-----------------');
}

// JTE TODO EXPERIMENTAL - map emoji's to text
function mapEmojiInput(text) {
  var retval  = text; // initialize return value to the input (i.e. no emoji mapped)

  console.log('mapEmojiInput() first two chars are', text.charCodeAt(0), text.charCodeAt(1));

  if( text.charCodeAt(0)==EMOJI_MONEY_STACK[0] && text.charCodeAt(1)==EMOJI_MONEY_STACK[1]
      || text.charCodeAt(0)==EMOJI_MONEY_BAG[0] && text.charCodeAt(1)==EMOJI_MONEY_BAG[1]) {
    // Money emoji --> what is value of my portfolio?
    retval = 'what is the value of my portfolio?';
    console.log('mapEmojiInput mapped', text, 'to', retval);
  }
  else if( text.charCodeAt(0)==EMOJI_LINE_GRAPH[0] && text.charCodeAt(1)==EMOJI_LINE_GRAPH[1]) {
    // Line graph --> how is my portfolio doing today?
    retval = 'how is my portfolio doing today?';
    console.log('mapEmojiInput mapped', text, 'to', retval);
  }

  return retval;
}

// Return a promise for calling the IBM Portfolio service
// Input param: Id of an existing portfolio
function getPortfolioHoldingsRP(portfolioId) {

  // JTE TODO is there a better way to dynamically construct RESTful path?
  var sURI = util.format("%s/%s/holdings", URL_GET_PORTFOLIO_HOLDINGS, portfolioId );

  var options = {
      uri: sURI,
      auth: {
        'user': CRED_PORTFOLIO_USERID,
        'pass': CRED_PORTFOLIO_PWD
      },
      json: true // Automatically parses the JSON string in the response
  };

  return rp(options);
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

function getHoldingsFromResponse(getHoldingsResp) {
  if( getHoldingsResp.holdings.length > 0 ) {
    return getHoldingsResp.holdings[0].holdings;
  }
  else {
    return [];
  }
}

function generatePlot(arrPricedHoldings, res) {
  console.log("arrPricedHoldings", arrPricedHoldings);

  /*
  var data = [
    {
      x: ["IBM", "GE", "AAPL"],
      y: [20000, 11000, 1400],
      type: "bar"
    }
  ];
  arrPricedHoldings [ { asset: 'IBM', quantity: 5200, position_value: 938444 },
    { asset: 'GE', quantity: 1200, position_value: 36000 } ]
  */

  // Prepare data formatted for Plot.ly
  var data = [];
  data.push( { "x":[], "y":[], "type":"bar"} );

  // JTE TODO only include the N largest positions
  for (var i = 0, len = arrPricedHoldings.length; i < len; i++) {
    data[0].x.push( arrPricedHoldings[i].asset);
    data[0].y.push( numeral(arrPricedHoldings[i].position_value).format('$0,0'));
  }
  //console.log("data[0]", data[0]);

  // Invoke Plot.ly API to generate plot
  var figure = {
      'data': data,
      marker: {color: "rgb(155, 83, 109)"},
      type: "bar"
  };

  var imgOpts = {
      format: 'png',
      width: 788,
      height: 500
  };

  var layout = {
    title: "Your Top Portfolio Positions",
    xaxis: {tickfont: {
        size: 14,
        color: "rgb(107, 107, 107)"
      }},
    yaxis: {
      title: "USD",
      titlefont: {
        size: 16,
        color: "rgb(107, 107, 107)"
      },
      tickfont: {
        size: 14,
        color: "rgb(107, 107, 107)"
      }
    }
  };

  console.log("Generating plot...");
  var graphOptions = {layout: layout, filename: "topH-bar", fileopt: "new"};
  plotly.plot(data, graphOptions, function (err, msg) {
      console.log(msg);

      /*
      { streamstatus: undefined,
        url: 'https://plot.ly/~teck-bioteck/8',
        message: '',
        warning: '',
        filename: 'topH-bar',
        error: '' }
      */

      var message = "Here are your largest holdings by value";
      var mediaUrl = msg.url + ".png"
      //https://plot.ly/~teck-bioteck/6.embed
      sendTwilioResponseWithMedia(message, mediaUrl, res);
  });
}

// Handes a single instrument
function getRiskAnalyticsRP(scenarioFilename, instrument) {

  var RISK_ANALYTICS_REQUESTED_ANALYTICS ='THEO/Value%2C THEO/Price';

  // Construct full RESTful URL
  var fullURL = RISK_ANALYTICS_URL + "/" + instrument;

  // Create request-promise POST request w/headers
  var req = rp.post({url:fullURL, json: true,
    headers: {
      'X-IBM-Access-Token': RISK_ANALYTICS_TOKEN,
      'EncType': 'multipart/form-data'
    }});

  // Populate the Form w/requested analytics and scenario_file
  var form = req.form();
  form.append('analytics', RISK_ANALYTICS_REQUESTED_ANALYTICS);
  form.append('scenario_file', fs.createReadStream(scenarioFilename));

  return req;
}

// Supports array of instruments param
function getRiskAnalyticsMultiRP(scenarioFilename, instruments) {

  // Generate promises for invoking risk analytics API on each instrument in array
  var rpPromises = [];
  for (var i = 0; i < instruments.length; i++) {
    rpPromise = getRiskAnalyticsRP(scenarioFilename, instruments[i]);
    rpPromises.push(rpPromise);
  }

  // Wait on all promises to complete
  return Promise.all(rpPromises);
}

/*
  INPUT:
  [
  	[{
  		instrument: 'CX_US681919BA38_USD',
  		scenario: 'Base Scenario (0.0000)',
  		values: [
        {
          "THEO/Value": "131.1828 USD",
          "date": "\"2017/03/10\""
        }
      ]
  	}, {
  		instrument: 'CX_US681919BA38_USD',
  		scenario: 'CONDITIONAL_1 (1.0000)',
  		values: [
        {
          "THEO/Value": "131.1718 USD",
          "date": "\"2017/03/10\""
        }
      ]
  	}],
  	[{
  		instrument: 'CX_US03523TBF49_USD',
  		scenario: 'Base Scenario (0.0000)',
  		values: [
        {
          "THEO/Value": "91.1828 USD",
          "date": "\"2017/03/10\""
        }
      ]
  	}, {
  		instrument: 'CX_US03523TBF49_USD',
  		scenario: 'CONDITIONAL_1 (1.0000)',
  		values: [
        {
          "THEO/Value": "89.0000 USD",
          "date": "\"2017/03/10\""
        }
      ]
  	}]
  ]

  OUTPUT:
  [ { id: 'CX_US681919BA38_USD',
      baseValue: '131.1828',
      theoValue: '131.1718',
      pcChange: -0.008385245626709966 },
    { id: 'CX_US03523TBF49_USD',
      baseValue: '91.1828',
      theoValue: '89.0000',
      pcChange: -2.3938725285909186 } ]
*/

function parseRiskAnalyticsResults(raResults) {

  var response = [];  // return value

  var BASE_SCENARIO_NAME_PREFIX = 'Base';
  var THEO_SCENARIO_NAME_PREFIX = 'CONDITIONAL';
  var ANALYTICS_NAME = 'THEO/Value';

  // For-each pair of base/theoretical analyses for an instrument
  for (var i = 0; i < raResults.length; i++) {

    // Instrument scenario analyses pair
    iaPair = raResults[i];
    insName = iaPair[0].instrument; // get instrument name from first analysis
    insBaseValue = insTheoValue = 0;

    // For each scenario analysis (should only be 2)
    for (var j = 0; j < iaPair.length; j++) {
      analysis = iaPair[j];

      // Handle base
      if( analysis.scenario.startsWith(BASE_SCENARIO_NAME_PREFIX)) {
        // Truncate trailing USD
        tmp = analysis.values[0][ANALYTICS_NAME];
        insBaseValue = tmp.split(' ')[0];
      }
      else if(analysis.scenario.startsWith(THEO_SCENARIO_NAME_PREFIX)) {
        // Truncate trailing USD
        tmp = analysis.values[0][ANALYTICS_NAME];
        insTheoValue = tmp.split(' ')[0];
      }
      else {
        // Don't know how to handle this type of scenario
        console.console.error("Invalid scenario", analysis.scenario, "skipping" );
        continue;  // <----------- continue --------------!
      }
    }

    //console.log("!!!", insName, insBaseValue, insTheoValue);

    // Very basic error-checking
    if( insBaseValue==0 || insTheoValue==0) {
      // Something went wrong with this instrument
      console.console.error("Instrument does not have values for base and conditional scenarios, skipping it" );
    }
    else {
      // Compute percent change
      pcChange = (insTheoValue-insBaseValue)/insBaseValue;
      response.push( {'id':insName, 'baseValue':insBaseValue, 'theoValue':insTheoValue, 'pcChange':pcChange});
    }
  }

  return response;
}

// Compute $ impact of a risk analysis on a portfolio
function portfolioRAImpact( portfolio, riskAnalytics ) {

  //console.log(">>>>>riskAnalytics", riskAnalytics);

  // Create map on risk analytics response (instrumentId => analysis)
  var mapRA = riskAnalytics.reduce(function(map,analytic) {
    map.set(analytic.id, analytic);
    return map;
  }, new HashMap());

  // Get the inner array of holdings from GetPorfolio response
  var holdings = getHoldingsFromResponse(portfolio);
  console.log('holdings',holdings);
  // Compute the overall change in portfolio value as well as
  // impact to each holding
  var totalValueChange = 0.0;
  var totalBaseValue = 0.0;
  var holdingsImpacts = [];
  for (var i = 0; i < holdings.length; i++) {

    holding = holdings[i];
    pcChange = 0;
    valueChange = 0.0;
    instrumentId = holding.instrumentId;
    assetName = holding.asset;
    quantity = holding.quantity;

    // Compute change in position value if an analytic was computed for it
    if( mapRA.has(instrumentId) ) {
      anal = mapRA.get(instrumentId);
      pcChange = anal.pcChange;
      valueChange = (anal.theoValue - anal.baseValue) * quantity;
      totalValueChange += valueChange;
      totalBaseValue += anal.baseValue * quantity;
    }

    holdingsImpacts.push( {'asset':assetName, 'quantity':quantity, 'pcChange':pcChange, 'valueChange':valueChange } );
  }

  // Compute the portion of value impact of each holding to the total
  for (var i = 0; i < holdingsImpacts.length; i++) {
    // JTE TODO handle Div0 (e.g. if no portfolio impact)
    holdingsImpacts[i].portfolioImpactPC = holdingsImpacts[i].valueChange / totalValueChange;
  }

  //console.log('totalBaseValue',totalBaseValue);
  portfolioImpact = { 'totalValueChange':totalValueChange, 'totalPCChange':totalValueChange/totalBaseValue, 'impactByHolding':holdingsImpacts};
  return portfolioImpact;
}

function getPortfolioImpactAnalysis(portfolioId, scenarioFilename, req, res) {

  // Call Portfolio service (via request-promise) to get holdings
  getPortfolioHoldingsRP(portfolioId)
    .then(function (getHoldingsResp) {
      var holdings = getHoldingsFromResponse(getHoldingsResp);
      console.log('Portfolio', portfolioId, 'holdings are:', holdings);

      // Check whether no holdings
      if(holdings == null || holdings.length < 1) {
        sendTwilioResponse('Your portfolio is empty', res);
        return;  // <------- return ------!
      }

      // Extract Instrument Id's into array
      var aInstrumentIds = holdings.reduce(function(arr,holding) {
        arr.push(holding.instrumentId);
        return arr;
      }, []);

      //console.log("aInstrumentIds", aInstrumentIds);

      getRiskAnalyticsMultiRP(scenarioFilename, aInstrumentIds)
      .then( function(riskAnalyticsResponse) {
        var analyticsForInstrumentsResponse = parseRiskAnalyticsResults(riskAnalyticsResponse);
        var portImpactResponse = portfolioRAImpact(getHoldingsResp, analyticsForInstrumentsResponse);

        console.log("portImpactResponse", portImpactResponse);

        // Analyze results and form response message
        var msg;
        if( portImpactResponse.totalValueChange == 0) {
          msg = 'Under that scenario your portfolio could be unaffected';
        } else
        {
          msg = util.format('Under that scenario your portfolio could %s by %s%, or %s',
                      (portImpactResponse.totalValueChange<0)?'decrease':'increase',
                      numeral(Math.abs(portImpactResponse.totalPCChange)*100.0).format('0,00.00'),
                      numeral(portImpactResponse.totalValueChange).format('$0,0')
                    );

        }

      sendTwilioResponse(msg, res);
    })
    .catch(function (err) {
      // API call failed...
      console.log("!!!!Error", JSON.stringify(err));
    })
    .then(function() {
      console.log("Finally called");
    });
  })
}


// Get the largest portfolio holdings - by value
function getTopPortfolioHoldings(portfolioId, req, res) {

  // Call Portfolio service (via request-promise) to get holdings
  getPortfolioHoldingsRP(portfolioId)
      .then(function (getHoldingsResp) {
          var holdings = getHoldingsFromResponse(getHoldingsResp);
          console.log('Portfolio', portfolioId, 'holdings are:', holdings);

          // Check whether no holdings
          if(holdings == null || holdings.length < 1) {
            sendTwilioResponse('Your portfolio is empty', res);
            return;  // <------- return ------!
          }

          // Collapse asset names into string list for calling Xignite bulk pricing service
          var strAssetNames = holdings.reduce(function(arr,holding) {
            arr.push(holding.asset);
            return arr;
          }, []).join();

          // Now invoke Xignite API to get prices of the holdings
          getXigniteLastPricesRP(strAssetNames)
            .then(function(prices) {
              console.log("Xignite response: ", prices);

              // Create a hashmap (assetName -> quantity)
              var mapHoldings = holdings.reduce(function(map,holding) {
                map.set(holding.asset, holding.quantity);
                return map;
              }, new HashMap());

              var arrPricedHoldings = prices.reduce(function(arr, price) {
                arr.push( { "asset" : price.Security.Symbol, "quantity" : mapHoldings.get(price.Security.Symbol), "position_value" : price.Last * mapHoldings.get(price.Security.Symbol) } );
                return arr;
              }, []);

              // Now sort on descending order of position value
              arrPricedHoldings.sort(function (a, b) {
                return b.position_value - a.position_value;
              });

              // Finally, take only the top N holdings
              arrPricedHoldings = arrPricedHoldings.slice(0,MAX_TOP_HOLDINGS);
              //console.log("arrPricedHoldings", arrPricedHoldings);
              generatePlot(arrPricedHoldings, res);
            })
            .catch(function (err) {
                // API call failed...
                console.log("Inner Error", err.message);
            })
      })
      .catch(function (err) {
          // API call failed...
          console.log("Outer Error", err.message);
      });
}

// Get the holdings (assest and shares) in the specified portfolio
function getPortfolioHoldings(portfolioId, req, res) {

  // Call Portfolio service (via request-promise) to get holdings
  getPortfolioHoldingsRP(portfolioId)
      .then(function (getHoldingsResp) {
          var holdings = getHoldingsFromResponse(getHoldingsResp);
          console.log('Portfolio', portfolioId, 'raw holdings are:', holdings);

          // Check whether no holdings
          if(holdings == null || holdings.length < 1) {
            sendTwilioResponse('Your portfolio is empty', res);
            return;  // <------- return ------!
          }

          // JTE TODO look at sorting holdings by asset name, size, etc?
          // Collapse asset names into string list for calling Xignite bulk pricing service
          var strPositions = holdings.reduce(function(arr,holding) {
            arr.push( util.format(" %s shares of %s", holding.quantity, holding.asset));
            return arr;
          }, []).join();

          var holdingsMsg = "Your portfolio consists of" + strPositions;
          console.log(holdingsMsg);
          sendTwilioResponse(holdingsMsg, res);
        })
        .catch(function (err) {
            // API call failed...
            console.log("Outer Error", err.message);
        });
}

// Respond to user saying Hello.  Grab the customer record based matching
// the supplied phone number as the key
function welcome(sessionContext, req, res) {

  // Set default response, if phone # unrecognized
  var msg = "Greetings friend. I don\'t believe we\'ve met before";

  // Is this phone number unrecognized?
  if( sessionContext && sessionContext.userProfile && sessionContext.userProfile.name) {
    // NOTE: assuming only one row since searched on unique key
    msg = "Hi " + sessionContext.userProfile.name + ". How can I help you?";
  }

  sendTwilioResponse(msg, res);
}

// Get the net and % portfolio performance relative to last close
// JTE TODO how to handle if security hasn't traded yet (or at all today)
// JTE TODO this doesn't take into account changes in position quantity between
//   today and the previous close.  i.e. it assumes the last close had the strAssetNames
//   size position as today!
function getPortfolioPerformanceToday(portfolioId, req, res) {

  // Call Portfolio service (via request-promise) to get holdings
  getPortfolioHoldingsRP(portfolioId)
      .then(function (getHoldingsResp) {
          var holdings = getHoldingsFromResponse(getHoldingsResp);
          console.log('Portfolio', portfolioId, 'holdings are:', holdings);

          // Check whether no holdings
          if(holdings == null || holdings.length < 1) {
            sendTwilioResponse('Your portfolio is empty', res);
            return;  // <------- return ------!
          }

          // Collapse asset names into string list for calling Xignite bulk pricing service
          var strAssetNames = holdings.reduce(function(arr,holding) {
            arr.push(holding.asset);
            return arr;
          }, []).join();

          // Now invoke Xignite API to get prices of the holdings
          getXigniteLastPricesRP(strAssetNames)
            .then(function(prices) {
              // Compute total value of portfolio
              console.log("Xignite response: ", prices);

              // Create a hashmap (assetName -> quantity)
              var mapHoldings = holdings.reduce(function(map,holding) {
                map.set(holding.asset, holding.quantity);
                return map;
              }, new HashMap());

              // Get current valuation of portfolio
              var currentValue = prices.reduce(function(val, price) {
                //console.log(val, price.Last,mapHoldings.get(price.Security.Symbol),(price.Last * mapHoldings.get(price.Security.Symbol)));
                return val + (price.Last * mapHoldings.get(price.Security.Symbol));
              }, 0);

              // Get current valuation of portfolio
              var prevCloseValue = prices.reduce(function(val, price) {
                //console.log(val, price.Last,mapHoldings.get(price.Security.Symbol),(price.Last * mapHoldings.get(price.Security.Symbol)));
                return val + (price.PreviousClose * mapHoldings.get(price.Security.Symbol));
              }, 0);

              var gainLoss = currentValue - prevCloseValue;
              var msg = util.format("Your portfolio is %s today by %d% or %s %s",
                                    (gainLoss>=0) ? EMOJI_UP_ARROW : EMOJI_DOWN_ARROW,
                                    numeral(gainLoss/prevCloseValue*100.0).format('0.00'),
                                    numeral(gainLoss).format('$0,0'),
                                    (gainLoss>=0) ? EMOJI_MODERATE_SMILE : ''
              );

              console.log("prevCloseValue", prevCloseValue, "currentValue", currentValue);
              console.log(msg);
              sendTwilioResponse(msg, res);
            })
            .catch(function (err) {
                // API call failed...
                console.log("Inner Error", err.message);
            })
      })
      .catch(function (err) {
          // API call failed...
          console.log("Outer Error", err.message);
      });
}

// Get the total value of a portfolio using last price obtained via Xignite
function getPortfolioValue(portfolioId, req, res) {

  // Call Portfolio service (via request-promise) to get holdings
  getPortfolioHoldingsRP(portfolioId)
      .then(function (getHoldingsResp) {
          var holdings = getHoldingsFromResponse(getHoldingsResp);
          console.log('Portfolio', portfolioId, 'holdings are:', holdings);

          // Check whether no holdings
          if(holdings == null || holdings.length < 1) {
            sendTwilioResponse('Your portfolio is empty', res);
            return;  // <------- return ------!
          }

          // Collapse asset names into string list for calling Xignite bulk pricing service
          var strAssetNames = holdings.reduce(function(arr,holding) {
            arr.push(holding.asset);
            return arr;
          }, []).join();

          // Now invoke Xignite API to get prices of the holdings
          getXigniteLastPricesRP(strAssetNames)
            .then(function(prices) {
              // Compute total value of portfolio
              console.log("Xignite response: ", prices);

              // Create a hashmap (assetName -> quantity)
              var mapHoldings = holdings.reduce(function(map,holding) {
                map.set(holding.asset, holding.quantity);
                return map;
              }, new HashMap());

              var totalValue = prices.reduce(function(val, price) {
                //console.log(val, price.Last,mapHoldings.get(price.Security.Symbol),(price.Last * mapHoldings.get(price.Security.Symbol)));
                return val + (price.Last * mapHoldings.get(price.Security.Symbol));
              }, 0);
              //console.log("totalValue", totalValue);
              return totalValue;
            })
            .then(function(totalValue) {
              var strValue = numeral(totalValue).format('$0,0');
              var msg = "Your current portfolio value is " + strValue;
              console.log(msg);
              sendTwilioResponse(msg, res);
            })
            .catch(function (err) {
                // API call failed...
                console.log("Inner Error", err.message);
            })
      })
      .catch(function (err) {
          // API call failed...
          console.log("Outer Error", err.message);
      });
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

  // JTE TODO EXPERIMENTAL - support emoji's
  inBody = mapEmojiInput(inBody);

  getSessionContext(phoneNum)
  .then( function() {

      var sessionContext = mcache.get(phoneNum) || null;

      console.log('/SMS got sessionContext', sessionContext);

      // Send the input to the conversation service
      conversation.message({
          input: { text: inBody },
          context : sessionContext.conversationContext,
          workspace_id: conversationWorkspace
        }, function(err, convResponse) {
          var responseMsg;

          // Handle error returned from Watson Conversation
          if (err) {
            console.error('Something bad happened, got an err: ' + JSON.stringify(err, null, 2));
            responseMsg = JSON.stringify(err, null, 2);
            sendTwilioResponse(responseMsg, res);
          }
          // Check if phone number unrecognized or unable to determine associated profile
          else if(sessionContext==null || sessionContext.userProfile==null || sessionContext.userProfile.portfolio==null) {
            console.error('Unable to determine portfolio for phoneNum', phoneNum);
            responseMsg = 'Your phone number was not recognized; please register with tom.eck@ibm.com';
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

            // Update session context, extending session
            sessionContext.conversationContext = convResponse.context;
            mcache.put(phoneNum, sessionContext,SESSION_IDLE_TIMEOUT_MS,
              function(key, value) {console.log('2cache was cleared for',key);});
            console.log('extended context for', phoneNum);

            if( "portfolio_valuation" == intentName ) {
              console.log('*** ACTION: Get portfolio value');
              getPortfolioValue(sessionContext.userProfile.portfolio, req,res);
              //mcache.del(phoneNum);
              //console.log('Context cleared for ' + phoneNum );
            }
            else if( "portfolio_holdings" == intentName ) {
              console.log('*** ACTION: Get portfolio holdings');
              getPortfolioHoldings(sessionContext.userProfile.portfolio, req,res);
              //mcache.del(phoneNum);
              //console.log('Context cleared for ' + phoneNum );
            }
            else if( "portfolio_top_holdings" == intentName ) {
              console.log('*** ACTION: Get TOP portfolio holdings');
              getTopPortfolioHoldings(sessionContext.userProfile.portfolio, req,res);
              //mcache.del(phoneNum);
              //console.log('Context cleared for ' + phoneNum );
            }
            else if( "portfolio_performance_today" == intentName ) {
              console.log('*** ACTION: Get today\'s portfolio performance');
              getPortfolioPerformanceToday(sessionContext.userProfile.portfolio, req,res);
              //mcache.del(phoneNum);
              //console.log('Context cleared for ' + phoneNum );
            }
            else if( "portfolio_impact_analysis" == intentName ) {
              console.log('*** ACTION: Get portfolio impact analysis');
              getPortfolioImpactAnalysis(sessionContext.userProfile.portfolio, ANALYTICS_SCENARIO_FILENAME, req,res);
              //mcache.del(phoneNum);
              //console.log('Context cleared for ' + phoneNum );
            }
            else if( "hello" == intentName ) {
              console.log('*** ACTION: Respond to welcome message');
              welcome(sessionContext,req,res);
              //mcache.put(phoneNum,data.context,SESSION_IDLE_TIMEOUT_MS);
              //console.log('Context set for ' + phoneNum );
            }
            else {
              // Store updated context since the conversation is not complete
              //mcache.put(phoneNum,data.context,SESSION_IDLE_TIMEOUT_MS);
              //console.log('Context set for ' + phoneNum );

              // Send back the response we got from Watson Conversation
              sendTwilioResponse(responseMsg, res);
            }
          } // else-not err
        }) // function(err, convResponse), conversation.message()
      }) // .then
      .catch(function (err) {
          // API call failed...
          console.log("/SMS caught Error", err.message);
      });
}); // app.post()

// Start server on host and port specified in CF config
// or Express defaults when running locally
app.listen(appEnv.port, '0.0.0.0', function() {
  console.log("server starting on " + appEnv.url);
});
