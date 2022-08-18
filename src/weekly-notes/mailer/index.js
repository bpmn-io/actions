const nodemailer = require('nodemailer');

module.exports = function sendEmail({ subject, text }) {

  const {
    EMAIL_TO: to,
    EMAIL_HOST: host,
    EMAIL_USERNAME: username,
    EMAIL_PASSWORD: password,
    EMAIL_REPLY_TO: replyTo
  } = process.env;


  const transport = nodemailer.createTransport({
    host,
    secure: true,
    auth: {
      user: username,
      pass: password
    }
  });

  const message = {
    to,
    replyTo,
    subject,
    text
  };

  return transport.sendMail(message);
};