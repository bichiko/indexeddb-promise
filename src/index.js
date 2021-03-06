const arraySorter = require('./array-sorter');
// you need to extend this Class and override config
class ModelConfig {
  get config() {

    return {
      debug: true,
      version: 1,
      databaseName: 'DefaultDatabase',
      tableName: 'roomTableView',
      primaryKey: {
        name: 'id',
        autoIncrement: true
      },
      /*add first row for testing*/
      initData: [
        {
          "roomId": 1,
          "roomName": "Cafe",
          "task": true
        }
      ],
      structure: {
        roomId: { unique: false, autoIncrement: true },
        roomName: { unique: false, autoIncrement: false },
        task: { unique: false, autoIncrement: false }
      }
    };
  }

  set( str ) {

    var struct = this.config.structure,
      keys = Object.keys( str ),
      error = false;
    keys.forEach( function ( key ) {
      if ( !struct.hasOwnProperty( key ) && this.config.debug ) {
        error = true;
        console.warn( 'No such key is defined in [setup config]: ', key );
      }
    }, this );

    if ( !this.config.primaryKey.autoIncrement ) {
      if ( !keys.hasOwnProperty( this.config.primaryKey.name ) && this.config.debug ) {
        error = true;
        console.warn( 'Add primary key as well or change it to autoincrement = true!' );
      }
    }

    if ( error && this.config.debug ) {
      console.info( 'Available column names: ', this.config.structure );
      console.info( 'Primary key: ', this.config.primaryKey );
    }

    return str;
  }
}

//main Class
let Model = function ( $mydata = {} ) {
  let $data = $mydata.config;
  let version = $data.version || 1,
    databaseName = $data.databaseName || 'r8IndexedDB',
    tableName = $data.tableName || 'defaultTable',
    primaryKey = $data.primaryKey || 'id',
    data = $data.initData || [],
    structure = $data.structure;
  this.struct = $mydata;
  this.tableName = tableName;
  this.fingersCrossed = new Promise( function ( resolve, reject ) {
    if ( !window || !( 'indexedDB' in window ) ) {

      return reject( 'Error: not supported Browser found!' );
    }

    if ( $data instanceof Array ) {

      return reject( 'Error: parameter [$data] has to be an Object!' );
    }

    let request = window.indexedDB.open( databaseName, version );

    request.onerror = function ( event ) {

      return reject( 'Error: Unknown', event.target );
    };

    request.onsuccess = function () {

      let connection = request.result;
      connection.onversionchange = function () {
        connection.close();
        console.info( 'connection closed...' );
      };

      return resolve( request.result );
    };

    request.onblocked = function ( event ) {
      event.target.result.close();
      console.warn( 'blocked' );
    };
    request.onupgradeneeded = function ( event ) {
      let db = event.target.result;

      if ( ( event.oldVersion < version && event.oldVersion !== 0 ) ||
        db.objectStoreNames.contains( tableName ) ) {
        db.deleteObjectStore( tableName );
        console.log( 'Table : ', tableName, ' removed!' )
        // db.close();
      }
      let objectStore = db.createObjectStore( tableName, {
        keyPath: primaryKey.name,
        autoIncrement: primaryKey.autoIncrement
      } );

      Object.entries( structure )
        .forEach( ( [ key, value ] ) => objectStore.createIndex( key, key, value ) );

      for ( let i in data ) {
        objectStore.add( data[ i ] );
      }
    };
  } );
};

Model.prototype.insertData = function ( data ) {

  let myData = this.struct.set( data );

  return new Promise( ( resolve, reject ) => {
    this.fingersCrossed.then( db => {
      let request = db.transaction( [ this.tableName ], "readwrite" )
        .objectStore( this.tableName ).add( myData );

      request.onsuccess = function () {
        return resolve( db );
      };

      request.onerror = function () {
        reject( "Error: Unable to add data. Check unique values!" );
      }
    } );
  } );
};


Model.prototype.selectFrom = function ( pkey ) {

  return new Promise( ( resolve, reject ) => {
    this.fingersCrossed.then( db => {
      let transaction = db.transaction( [ this.tableName ] );
      let objectStore = transaction.objectStore( this.tableName );
      let request = objectStore.get( pkey );
      request.onerror = function () {
        return reject( "Unable to retrieve data from Model!" );
      };
      request.onsuccess = function () {
        if ( request.result ) {
          return resolve( request.result );
        } else {
          return reject( "No result found in your Model!" );
        }
      };
    } );
  } );
};

Model.prototype.selectAll = function () {

  return new Promise( ( resolve, reject ) => {
    this.fingersCrossed.then( db => {
      let objectStore = db.transaction( this.tableName ).objectStore( this.tableName ),
        dataBucket = [];

      let store = objectStore.openCursor();
      store.onsuccess = function ( event ) {
        let cursor = event.target.result;
        if ( cursor ) {
          dataBucket.push( cursor.value );
          cursor.continue();
        } else {
          return resolve( dataBucket );
        }
      };
      store.onerror = function () {
        return reject( 'Can\'t open cursor' );
      };
    } );
  } );
};


Model.prototype.selectWhere = function ( props = {
  /* limit: -1,
   where: () => {},
   orderByDESC: true,
   sortBy: 'comments' or ['comments', 'date']*/
} ) {

  props = new Proxy( props, {
    get: function ( target, name ) {
      return name in target ? target[ name ] : false;
    }
  } );

  return new Promise( ( resolve, reject ) => {
    this.selectAll().then( data => {
      if ( data && data.length > 0 ) {
        return resolve( data );
      }
      return reject( 'Data is empty' );
    } )
  } ).then( dataBucket => {
    if ( 'where' in props && props.where !== false ) {
      if ( dataBucket.length === 0 ) return [];

      if ( typeof props.where === 'function' ) {
        //do whatever like in callback fn and return
        dataBucket = props.where( dataBucket );
      }
    }

    if ( 'sortBy' in props && props.sortBy ) {
      //sort data
      dataBucket = arraySorter( dataBucket ).sortBy( {
        desc: 'orderByDESC' in props && props.orderByDESC,
        keys: props.sortBy
      } );
    }

    if ( 'limit' in props && props.limit !== false ) {
      //slice data
      dataBucket = dataBucket.slice( 0, +props.limit );
    }

    return dataBucket;
  } );
};

Model.prototype.updateWhere = function ( pKey, keyval ) {
  return new Promise( ( resolve, reject ) => {
    this.fingersCrossed.then( db => {
      this.selectFrom( pKey ).then( data => {
        var transaction = db.transaction( [ this.tableName ], "readwrite" );
        var store = transaction.objectStore( this.tableName );
        keyval = Object.assign( data, keyval );
        let done = store.put( keyval );
        done.onsuccess = function () {
          return resolve( true );
        };
        done.onerror = function () {
          return reject( true );
        };
      } );
    } );
  } );
};

Model.prototype.deleteWhere = function ( pkey ) {

  return new Promise( ( resolve, reject ) => {
    this.fingersCrossed.then( db => {
      let request = db.transaction( [ this.tableName ], "readwrite" )
        .objectStore( this.tableName ).delete( pkey );

      request.onsuccess = function () {

        return resolve( "Some Data have been removed from your Model." );
      };
      request.onerror = function () {
        return reject( 'couldn\'t delete' );
      };
    } );
  } );
};

module.exports = {
  ModelConfig,
  Model
};

