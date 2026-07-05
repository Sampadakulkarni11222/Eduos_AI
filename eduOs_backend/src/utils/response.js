export const sendSuccess = (res, data = null, message = 'Success', statusCode = 200) =>
  res.status(statusCode).json({ success: true, message, data });

export const sendError = (res, message = 'Something went wrong', statusCode = 500, errors = []) =>
  res.status(statusCode).json({ success: false, message, errors });

export const sendPaginated = (res, data, meta, message = 'Success') =>
  res.status(200).json({ success: true, message, data, meta });
