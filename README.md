# Node.js Cognitive Conversation sample

This application demonstrates an SMS-based chat-bot server application.  It uses Node.js and Express along with IBM Watson and Twilio to deliver an AI-enhanced chat experience.

## Prerequisites

You need some development tools installed on your local machine (e.g. Macbook, Windows laptop) in order to create a Node application.  Follow these steps to get setup.

1. Open a Terminal (Mac) or Command (Windows) window
+ Check whether Node is installed by typing: `node --version`

  If you get a response like "v6.9.1", then Node is installed.  If you get any error such as 'command not found', then you need to install Node (see below).
+ Check whether Node Package Manager (npm) is installed by typing: `npm --version`

  If you get a response like "4.1.1", then npm is installed.  If you get any error such as 'command not found', then you need to install Node Package Manager (see below)
+ Check whether HomeBrew is installed (MacOS only) by typing  `brew --version`

  If you get a response like "homebrew 1.1.10", then brew is installed and you can jump to Step 6.  If you get any error such as 'command not found', proceed to Step 5

+ Install HomeBrew by copying and pasting this entire command into your Terminal window:

  ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"

+ Install Node by typing `brew install node`

+ Install Node Package Manager by typing `brew install npm`

## Get the code

Now get a copy of the source code for this application and build it by entering the following commands in your Terminal window:

1. `git clone https://github.com/tomeck/cogcov.git`
+  `cd cogcov`
+  `npm install`

## Run the app locally

1. Type `npm start` to start the app

  If the server successfully starts you will see a message like this:

  `server starting on http://localhost:6002`
+ Access the running app in a browser at <http://localhost:6002/SMS>  (or whatever address the server started on in the previous step)
+ You should see the following response in your web browser if all is working correctly:

  `Hello World`


## Twilio integration (skip this section for now)

Copy the URL and paste it PLUS "/SMS" into the Webhook POST handler for Messages for the phone number on Twilio

Send an SMS to the Twilio number

The webhook handler will receive FORM-URLENCODED data like this:

ToCountry=US&ToState=NJ&SmsMessageSid=SMedbc692d9f072246566a5b8c9f69c312&NumMedia=0&ToCity=LONG+BRANCH&FromZip=07734&SmsSid=SMedbc692d9f072246566a5b8c9f69c312&FromState=NJ&SmsStatus=received&FromCity=LONG+BRANCH&Body=Test&FromCountry=US&To=%2B17327599154&ToZip=07764&NumSegments=1&MessageSid=SMedbc692d9f072246566a5b8c9f69c312&AccountSid=ACbb28e740dadc52c2575f545b1d544b83&From=%2B17322335390&ApiVersion=2010-04-01

A sample curl script that works is:
$ curl --data "ToCountry=US&ToState=NJ&SmsMessageSid=SMedbc692d9f072246566a5b8c9f69c312&NumMedia=0&ToCity=LONG+BRANCH&FromZip=07734&SmsSid=SMedbc692d9f072246566a5b8c9f69c312&FromState=NJ&SmsStatus=received&FromCity=LONG+BRANCH&Body=Test&FromCountry=US&To=%2B17327599154&ToZip=07764&NumSegments=1&MessageSid=SMedbc692d9f072246566a5b8c9f69c312&AccountSid=ACbb28e740dadc52c2575f545b1d544b83&From=%2B17322335390&ApiVersion=2010-04-01" localhost:1337/sms
