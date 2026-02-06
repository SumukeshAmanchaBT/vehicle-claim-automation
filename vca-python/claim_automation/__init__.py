import pymysql

# Make PyMySQL pretend to be a recent mysqlclient/MySQLdb version
# so Django's MySQL backend will accept it.
pymysql.version_info = (2, 2, 1, "final", 0)
pymysql.install_as_MySQLdb()

