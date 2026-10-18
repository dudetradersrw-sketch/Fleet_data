function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetNames = ["Contacts", "Trucks", "Trailers", "Combinations", "Drivers", "Garage", "Monitoring", "Containers", "Invoices", "Expenses", "Users", "Trips", "Clearing", "ClearingInvoices", "ClearingPayments"];
  var data = {};
  
  sheetNames.forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (sheet) {
      var rows = sheet.getDataRange().getValues();
      if (rows.length > 0) {
        var rawHeaders = rows[0];
        var headers = rawHeaders.map(function(h) {
          return String(h).trim().replace(/\s+/g, '');
        });
        var list = [];
        for (var i = 1; i < rows.length; i++) {
          var obj = {};
          for (var j = 0; j < headers.length; j++) {
            var val = rows[i][j];
            if (typeof val === 'string' && (val.indexOf('[') === 0 || val.indexOf('{') === 0)) {
              try { val = JSON.parse(val); } catch(err) {}
            }
            obj[headers[j]] = val;
          }
          list.push(obj);
        }
        data[name] = list;
      } else {
        data[name] = [];
      }
    } else {
      data[name] = [];
    }
  });

  var jsonString = JSON.stringify(data);
  var callback = e && e.parameter && e.parameter.callback;
  
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + jsonString + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    return ContentService.createTextOutput(jsonString)
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  return handleRequest(e, "POST");
}

function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}

// --- GLOBAL HELPER TO UPLOAD FILES TO GOOGLE DRIVE ---
function processDriveUploads(inputData, folderId) {
  var attachmentArray = inputData;
  
  // Convert incoming JSON string to a real array if needed
  if (typeof attachmentArray === 'string') {
    try {
      attachmentArray = JSON.parse(attachmentArray);
    } catch(e) {
      return inputData;
    }
  }
  
  if (!Array.isArray(attachmentArray)) return inputData;
  
  try {
    var folder = DriveApp.getFolderById(folderId);
    attachmentArray.forEach(function(att) {
      // Check both .data and .url for raw base64 data strings
      var val = att.data || att.url;
      if (val && typeof val === 'string' && val.indexOf("data:") === 0) {
        var parts = val.split(',');
        var mimeMatch = parts[0].match(/:(.*?);/);
        var mimeType = mimeMatch ? mimeMatch[1] : (att.type || "application/octet-stream");
        
        var decodedFile = Utilities.base64Decode(parts[1]);
        var blob = Utilities.newBlob(decodedFile, mimeType, att.name || "Document");
        
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        
        var fileUrl = "https://drive.google.com/file/d/" + file.getId() + "/preview";
        att.data = fileUrl;
        att.url = fileUrl;
      }
    });
  } catch(driveErr) {
    Logger.log("Drive Upload Error: " + driveErr.toString());
  }
  
  return attachmentArray;
}

function handleRequest(e, method) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var folderId = "1poZVjmY3ZtYQ4OqHg9LXuHhR5qGq0Twu"; // Google Drive Folder ID
  
  try {
    if (method === "POST") {
      var payload = JSON.parse(e.postData.contents);
      var sheetName = payload.sheet || payload.table;
      var action = payload.action;
      var data = payload.data || {};
      
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      }
      
      // Process and upload attachments for all possible keys
      if (data.Attachments) {
        data.Attachments = processDriveUploads(data.Attachments, folderId);
      }
      if (data.InsuranceAttachments) {
        data.InsuranceAttachments = processDriveUploads(data.InsuranceAttachments, folderId);
      }
      if (data.InspectionAttachments) {
        data.InspectionAttachments = processDriveUploads(data.InspectionAttachments, folderId);
      }
      
      var rows = sheet.getDataRange().getValues();
      var rawHeaders = rows.length > 0 ? rows[0] : [];
      
      if (rawHeaders.length === 0 && data) {
        rawHeaders = Object.keys(data);
        sheet.appendRow(rawHeaders);
        rows = sheet.getDataRange().getValues();
      }
      
      var headers = rawHeaders.map(function(h) {
        return String(h).trim().replace(/\s+/g, '');
      });
      
      // --- Users Table Special Routing ---
      if (sheetName === "Users") {
        if (action === "add") {
          var userId = data.ID || "USR-" + Date.now().toString().slice(-4);
          sheet.appendRow([userId, data.Username, data.Password, data.Category, JSON.stringify(data.Permissions || []), data.Name]);
          return responseSuccess();
        } else if (action === "update") {
          var targetId = String(data.ID);
          for (var i = 1; i < rows.length; i++) {
            if (String(rows[i][0]) === targetId) {
              sheet.getRange(i + 1, 1, 1, 6).setValues([[
                targetId, 
                data.Username || rows[i][1], 
                data.Password || rows[i][2], 
                data.Category || rows[i][3], 
                data.Permissions ? JSON.stringify(data.Permissions) : rows[i][4], 
                data.Name || rows[i][5]
              ]]);
              break;
            }
          }
          return responseSuccess();
        } else if (action === "delete") {
          var delId = String(data.id || data.ID);
          for (var i = 1; i < rows.length; i++) {
            if (String(rows[i][0]) === delId) {
              sheet.deleteRow(i + 1);
              break;
            }
          }
          return responseSuccess();
        }
      }
      
      // --- Standard Table Action: ADD / CREATE ---
      if (action === "add" || action === "create") {
        var newRow = rawHeaders.map(function(h) {
          var cleanH = String(h).trim().replace(/\s+/g, '');
          if (cleanH === "ID") return data[cleanH] || ("FD-" + Date.now().toString().slice(-4));
          if (cleanH === "Status" && !data[cleanH]) return "Loaded";
          
          if (cleanH === "Attachments" || cleanH === "AttachmentData" || cleanH === "InsuranceAttachments" || cleanH === "InspectionAttachments") {
            return JSON.stringify(data[cleanH] || []);
          }
          
          var val = data[cleanH];
          if (val !== undefined && val !== null) {
            return typeof val === 'object' ? JSON.stringify(val) : val;
          }
          return "";
        });
        sheet.appendRow(newRow);
        return responseSuccess();
      }
      
      // --- Standard Table Action: UPDATE ---
      if (action === "update") {
        var targetId = String(data.ID);
        var updated = false;
        for (var i = 1; i < rows.length; i++) {
          if (String(rows[i][0]) === targetId) {
            var updatedRow = rawHeaders.map(function(h, j) {
              var cleanH = String(h).trim().replace(/\s+/g, '');
              if (cleanH === "ID") return targetId;
              
              if (cleanH === "Attachments" || cleanH === "AttachmentData" || cleanH === "InsuranceAttachments" || cleanH === "InspectionAttachments") {
                return JSON.stringify(data[cleanH] || data[h] || []);
              }
              
              var val = data[cleanH] !== undefined ? data[cleanH] : data[h];
              if (val !== undefined && val !== null && val !== "") {
                return typeof val === 'object' ? JSON.stringify(val) : val;
              }
              // Preserve existing row cell value if not provided in payload
              return rows[i][j];
            });
            sheet.getRange(i + 1, 1, 1, updatedRow.length).setValues([updatedRow]);
            updated = true;
            break;
          }
        }
        if (!updated) {
          var newRow = rawHeaders.map(function(h) {
            var cleanH = String(h).trim().replace(/\s+/g, '');
            if (cleanH === "ID") return targetId;
            
            if (cleanH === "Attachments" || cleanH === "AttachmentData" || cleanH === "InsuranceAttachments" || cleanH === "InspectionAttachments") {
              return JSON.stringify(data[cleanH] || []);
            }
            
            var val = data[cleanH];
            if (val !== undefined && val !== null) {
              return typeof val === 'object' ? JSON.stringify(val) : val;
            }
            return "";
          });
          sheet.appendRow(newRow);
        }
        return responseSuccess();
      }
      
      // --- Standard Table Action: DELETE ---
      if (action === "delete") {
        var delId = String(data.id || data.ID);
        for (var i = 1; i < rows.length; i++) {
          if (String(rows[i][0]) === delId) {
            sheet.deleteRow(i + 1);
            break;
          }
        }
        return responseSuccess();
      }
      
      // --- Standard Table Action: ARCHIVE ---
      if (action === "archive") {
        var statusColIndex = headers.indexOf("Status");
        if (statusColIndex !== -1) {
          for (var i = 1; i < rows.length; i++) {
            if (String(rows[i][0]) === String(data.id)) {
              sheet.getRange(i + 1, statusColIndex + 1).setValue("Archived");
              break;
            }
          }
        }
        return responseSuccess();
      }
    }
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function responseSuccess() {
  return ContentService.createTextOutput(JSON.stringify({status: "success"}))
    .setMimeType(ContentService.MimeType.JSON);
}